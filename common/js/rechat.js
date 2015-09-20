this.ReChat = $.extend({
  // Settings:
  searchBaseUrl: 'http://search.rechat.org/videos/',
  chatDisplayLimit: 1000,
  loadingDelay: 3000,
  nicknameColors: Please.make_color({ colors_returned: 50, saturation: 0.7 }),
  defaultStreamDelay: 17,

  chunkTimeLength: 30,
  chunkPreloadTime: 10,

  autolinker: new Autolinker({
    urls: true,
    email: true,
    twitter: false,
    phone: false,
    stripPrefix: false
  }),

  get: function(path, params, success, failure) {
    var jqxhr = $.get(path, params, success);
    if (failure) {
      jqxhr.fail(failure);
    }
    return null;
  }
}, this.ReChat || {});

ReChat.Playback = function(videoId, recordedAt) {
  this.videoId = videoId;
  this.recordedAt = recordedAt;
  this.streamDelay = ReChat.defaultStreamDelay;
};

ReChat.Playback.prototype._prepareInterface = function() {
  var that = this;

  var containerTab = $('#right_col .rightcol-content .tab-container').not('.hidden').first();
  var containerChat = $('<div>').addClass('chat-container js-chat-container');

  var containerEmber = $('<div>').css({
    'z-index': 4,
    'background-color': '#f2f2f2',
    'margin': 0
  }).addClass('ember-chat');
  this._container = containerEmber;

  var header = $('<div>').css({
    'display': 'block',
    'position': 'relative',
    'top': '0px',
    'height': '20px',
    'padding': '10px 0',
    'line-height': '20px',
    'text-align': 'center',
    'font-size': '14px',
    'z-index': '5',
    'width': '100%',
    'box-shadow': 'inset 0 -1px 0 0 rgba(0,0,0,0.2)'
  });
  header.addClass('chat-header');
  header.text('ReChat for Twitch™ ' + ReChat.getExtensionVersion());
  containerEmber.append(header);

  var statusMessage = $('<div>').css({
    'position': 'relative',
    'top': '50px',
    'text-align': 'center',
    'background-repeat': 'no-repeat',
    'background-position': 'center top',
    'background-size': '40px 40px',
    'padding': '60px 20px',
    'z-index': 100
  });
  containerEmber.append(statusMessage);
  this._statusMessageContainer = statusMessage;

  var chatMessages = $('<div>').css({
    'position': 'absolute',
    'right': 0,
    'top': '40px',
    'bottom': 0,
    'left': 0,
    'width': 'auto',
    'height': 'auto',
    'overflow-x': 'hidden',
    'overflow-y': 'auto'
  });
  chatMessages.addClass('ember-chat chat-messages chat-lines');
  containerEmber.append(chatMessages);
  this._chatMessageContainer = chatMessages;

  var moreMessagesIndicator = $('<div>').css({
    'cursor': 'pointer',
    'position': 'absolute',
    'z-index': '1',
    'text-align': 'center',
    'left': 0,
    'right': 0,
    'bottom': 0,
    'background-color': 'rgba(0,0,0,0.7)',
    'color': '#fff',
    'padding': '5px 0'
  });
  moreMessagesIndicator.addClass('ember-view more-messages-indicator');
  moreMessagesIndicator.text('More messages below.');
  moreMessagesIndicator.hide();
  moreMessagesIndicator.click(function() {
    chatMessages.scrollTop(chatMessages.prop('scrollHeight') - chatMessages.prop('clientHeight'));
    that._staydown.lock();
  })
  containerEmber.append(moreMessagesIndicator);
  this._moreMessageIndicator = moreMessagesIndicator;

  // Append the ember to the chat and right panel container
  containerChat.append(containerEmber);
  containerTab.append(containerChat);

  // Auto scroll chat messages to bottom
  this._staydown = new StayDown({
    target: chatMessages.get(0),
    interval: 100,
    callback: function(event) {
      switch (event) {
        case 'release':
          that._moreMessageIndicator.show();
          that._userScrolling = true;
          break;
        case 'lock':
          that._moreMessageIndicator.hide();
          that._userScrolling = false;
          break;
      }
    }
  });

  // Add Theatre button
  var theatreButton = $('<span>').
    addClass('theatre-button glyph-only button action tooltip').
    attr('onclick', 'ReChat.handleTheatreMode()').
    attr('title', 'Theater Mode (Alt+T)');
  theatreButton.append('<svg class="svg-theatre" height="16px" version="1.1" viewbox="0 0 16 16" width="16px" x="0px" y="0px"><path clip-rule="evenodd" d="M1,13h9V3H1V13z M11,3v10h4V3H11z" fill-rule="evenodd"></path></svg>');
  var shareChannel = $('.channel-actions').find('> span:last-child').prev();
  shareChannel.append(theatreButton);

  var exitTheatreButton = $('<div>').
    addClass('exit-theatre').
    attr('onclick', 'ReChat.handleTheatreMode()');
  var exitTheatreButtonLink = $('<a>').text('Exit Theater Mode');
  exitTheatreButton.append(exitTheatreButtonLink);
  $('#player').append(exitTheatreButton);

};

ReChat.Playback.prototype._loadMessages = function(receivedAfter, callback) {
  var that = this;
  if (!that._connectionErrors) {
    that._connectionErrors = 0;
  }
  ReChat.get(ReChat.searchBaseUrl + this.videoId + '/chunk',
             {
               'start': receivedAfter.toISOString()
             },
             function(response) {
               that._connectionErrors = 0;
               callback(response);
             },
             function(response) {
               if (response && response.status == 404) {
                 // invalid VOD
                 that._noChunkAfter = receivedAfter;
               } else {
                 // server error, let's try again in 10 seconds
                 that._connectionErrors += 1;
                 setTimeout(function() {
                   if (!that._stopped) {
                     that._autoPopulateCache();
                   }
                 }, 1000 * Math.pow(2, that._connectionErrors));
               }
             });
};

ReChat.Playback.prototype._currentVideoTime = function() {
  return (parseFloat($('body').attr('rechat-video-time')) || 0) + this.streamDelay;
};

ReChat.Playback.prototype._currentAbsoluteVideoTime = function() {
  return new Date(+this.recordedAt + this._currentVideoTime() * 1000);
};

ReChat.Playback.prototype._getChunkTime = function(date) {
  var chunkTime = new Date(date);
  chunkTime.setMilliseconds(0);
  chunkTime.setSeconds(chunkTime.getSeconds() - (chunkTime.getSeconds() % ReChat.chunkTimeLength));
  return chunkTime;
}

ReChat.Playback.prototype._autoPopulateCache = function(delayLoading) {
  var newestMessageDate = this._nextChunkDate,
      currentAbsoluteVideoTime = this._currentAbsoluteVideoTime(),
      populationId = new Date(),
      that = this;
  if (!newestMessageDate || currentAbsoluteVideoTime > newestMessageDate) {
    newestMessageDate = currentAbsoluteVideoTime;
  }
  this._cachePopulationId = populationId;
  var loadingFunction = function() {
    var chunkStartDate = that._getChunkTime(newestMessageDate);
    console.info('ReChat: Loading chunk with start date of ' + chunkStartDate);
    that._loadMessages(chunkStartDate, function(result) {
      if (populationId != that._cachePopulationId) {
        console.info('ReChat: Caching ID changed, lock expired, aborting...');
        return;
      }
      if (result.no_messages) {
        if (!result.next) {
          that._noChunkAfter = chunkStartDate;
        } else {
          that._firstMessageDate = new Date(result.next);
          that._nextChunkDate = that._getChunkTime(result.next);
        }
      } else {
        var hits = result.hits;
        console.info('ReChat: Received ' + result.total + ' hits (' + result.begin + ' - ' + result.end + ')');
        newestMessage = hits[hits.length - 1];
        that._nextChunkDate = new Date(result.end);
        if (!that._cachedMessages || that._cachedMessages.length == 0) {
          that._firstMessageDate = new Date(hits[0].recieved_at);
          that._cachedMessages = hits;
        } else {
          Array.prototype.push.apply(that._cachedMessages, hits);
        }
        that._cacheExhaustionHandled = false;
      }
    });
  };

  if (delayLoading) {
    if (this._loadingTimeout) {
      clearTimeout(this._loadingTimeout);
    }
    this._loadingTimeout = setTimeout(loadingFunction, ReChat.loadingDelay);
  } else {
    loadingFunction();
  }
};

ReChat.Playback.prototype._showStatusMessage = function(message, statusImage) {
  if (!statusImage) {
    statusImage = 'spinner.gif';
  }
  if (this._lastStatusImage != statusImage) {
    this._statusMessageContainer.css('background-image', 'url(' + ReChat.getExtensionResourcePath('res/' + statusImage) + ')');
    this._lastStatusImage = statusImage;
  }
  this._chatMessageContainer.empty();
  this._statusMessageContainer.text(message);
  this._statusMessageContainer.show();
};

ReChat.Playback.prototype._hideStatusMessage = function() {
  this._statusMessageContainer.hide();
};

ReChat.Playback.prototype._checkCacheExhaustion = function(currentAbsoluteVideoTime) {
  if (!this._nextChunkDate) {
    return;
  }
  var secondsUntilNextChunk = (this._nextChunkDate.getTime() - currentAbsoluteVideoTime.getTime()) / 1000;
  if (!this._cacheExhaustionHandled && secondsUntilNextChunk <= ReChat.chunkPreloadTime) {
    this._cacheExhaustionHandled = true;
    this._autoPopulateCache();
  }
}

ReChat.Playback.prototype._replay = function() {
  var currentVideoTime = this._currentVideoTime(),
      currentAbsoluteVideoTime = this._currentAbsoluteVideoTime(),
      previousVideoTime = this._previousVideoTime,
      that = this;
  if (typeof previousVideoTime == 'undefined') {
    // first invocation => populate cache
    this._showStatusMessage('Loading messages...');
    console.info('First invocation, populating cache for the first time');
    this._autoPopulateCache(true);
  } else if (previousVideoTime - 10 > currentVideoTime || currentVideoTime > previousVideoTime + 60) {
    console.info('Time jumped from ' + previousVideoTime + ' to ' + currentVideoTime + ', discarding cache and starting over');
    this._showStatusMessage('Loading messages...');
    this._firstMessageDate = null;
    this._nextChunkDate = null;
    this._cachedMessages = [];
    this._autoPopulateCache(true);
  } else if (this._noChunkAfter && currentAbsoluteVideoTime >= this._noChunkAfter) {
    if (this._chatMessageContainer.is(':empty')) {
      this._showStatusMessage('Sorry, no chat messages for this VOD available. The VOD is either too old or the channel didn\'t get enough viewers when it was live.', 'sad.png');
    }
  } else if (this._firstMessageDate && this._firstMessageDate > currentAbsoluteVideoTime && this._chatMessageContainer.is(':empty')) {
    var secondsToFirstMessage = Math.ceil(this._firstMessageDate.getTime() / 1000 - currentAbsoluteVideoTime.getTime() / 1000);
    if (secondsToFirstMessage > 0) {
      var minutesToFirstMessage = Math.floor(secondsToFirstMessage / 60);
      secondsToFirstMessage -= minutesToFirstMessage * 60;
      secondsToFirstMessage = secondsToFirstMessage < 10 ? '0' + secondsToFirstMessage : secondsToFirstMessage;
      this._showStatusMessage('First recorded message will show up in ' + minutesToFirstMessage + ':' + secondsToFirstMessage);
    }
    this._checkCacheExhaustion(currentAbsoluteVideoTime);
  } else if (!this._cachedMessages || !this._cachedMessages.length) {
    console.info('ReChat: Cache is empty, waiting...');
    this._checkCacheExhaustion(currentAbsoluteVideoTime);
  } else {
    this._checkCacheExhaustion(currentAbsoluteVideoTime);
    while (this._cachedMessages.length) {
      var messageData = this._cachedMessages[0],
          messageDate = new Date(messageData.recieved_at);
      if (messageDate <= currentAbsoluteVideoTime) {
        this._cachedMessages.shift();
        delete this._timeouts[messageData.from];
        if (messageData.from == 'twitchnotify') {
          var formattedMessage = this._formatSystemMessage(messageData);
        } else if (messageData.from == 'jtv') {
          var formattedMessage = this._formatJtvMessage(messageData);
        } else {
          var formattedMessage = this._formatChatMessage(messageData);
        }
        if (formattedMessage != null) {
          this._hideStatusMessage();
          this._chatMessageContainer.append(formattedMessage);
        }
      } else {
        break;
      }
    }

    if (!this._userScrolling) {
      var numberOfChatMessagesDisplayed = this._chatMessageContainer.find('.rechat-chat-line').length;
      if (numberOfChatMessagesDisplayed >= ReChat.chatDisplayLimit) {
        this._chatMessageContainer.find('.rechat-chat-line:lt(' + Math.max(numberOfChatMessagesDisplayed - ReChat.chatDisplayLimit, 10) + ')').remove();
      }
    }
  }
  this._previousVideoTime = currentVideoTime;
  if (!this._stopped) {
    setTimeout(function() {
      that._replay();
    }, 200);
  }
};

ReChat.Playback.prototype._colorForNickname = function(nickname, usercolor) {
  if (usercolor) {
    return '#' + ('000000' + usercolor.toString(16)).slice(-6);
  } else {
    return this._generateColorForNickname(nickname);
  }
};

ReChat.Playback.prototype._generateColorForNickname = function(nickname) {
  var hash = 0, i, chr, len;
  if (nickname.length == 0) return hash;
  for (i = 0, len = nickname.length; i < len; i++) {
    chr   = nickname.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  hash = Math.abs(hash);
  return ReChat.nicknameColors[hash % (ReChat.nicknameColors.length - 1)];
};

ReChat.Playback.prototype._replaceEmoticonsByRanges = function(text, emotes) {
  var escapeHelper = $('<div>'),
      escapeAndLink = function(text) {
        return ReChat.autolinker.link(escapeHelper.text(text).html());
      };
  if (!emotes) {
    return escapeAndLink(text);
  }
  var emotesToReplace = [],
      emotes = emotes.split('/');
  $.each(emotes, function(i, emoteDataRaw) {
    var emoteData = emoteDataRaw.split(':'),
        emoteId = emoteData[0],
        emoteRanges = emoteData[1].split(',');
    $.each(emoteRanges, function(j, emoteRange) {
      var emoteRangeParts = emoteRange.split('-'),
          emoteRangeBegin = parseInt(emoteRangeParts[0]),
          emoteRangeEnd = parseInt(emoteRangeParts[1]);
      emotesToReplace.push({ id: emoteId, begin: emoteRangeBegin, end: emoteRangeEnd });
    });
  });
  emotesToReplace.sort(function(x, y) {
    return x.begin - y.begin;
  });
  var offset = 0,
      messageHtml = '';
  $.each(emotesToReplace, function(i, emote) {
    var emoteText = text.substring(emote.begin, emote.end + 1),
        imageBaseUrl = '//static-cdn.jtvnw.net/emoticons/v1/' + emote.id,
        image = $('<img>').attr({
          src: imageBaseUrl + '/1.0',
          srcset: imageBaseUrl + '/2.0 2x',
          alt: emoteText,
          title: emoteText
        }).addClass('emoticon'),
        imageHtml = image[0].outerHTML;
    messageHtml += escapeAndLink(text.substring(offset, emote.begin));
    messageHtml += imageHtml;
    offset = emote.end + 1;
  });
  messageHtml += escapeAndLink(text.substring(offset));
  return messageHtml;
};

ReChat.Playback.prototype._formatChatMessage = function(messageData) {
  var userColor = this._colorForNickname(messageData.from, messageData.usercolor);
  var line = $('<div>').addClass('chat-line rechat-chat-line rechat-user-' + messageData.from);
  // Add data attributes
  line.attr('data-sender', messageData.from);
  line.attr('data-room', messageData.to.substring(1));
  // From line
  var from = $('<span>').addClass('from').css({
        'color': userColor,
        'font-weight': 'bold'
      }),
      colon = $('<span>').addClass('colon'),
      message = $('<span>').addClass('message').css({ 'word-wrap': 'break-word' }),
      messageText = messageData.message;
  if (messageText.substring(0, 8) == "\x01ACTION ") {
    message.css({ 'color': userColor });
    messageText = messageText.substring(8);
  } else {
    colon.text(':');
  }
  from.text(messageData.from.replace('\\s', ' '));
  var messageHtml = this._replaceEmoticonsByRanges(messageText, messageData.emotes);
  message.html(messageHtml);
  line.append(from).append(colon).append(' ').append(message);
  return line;
};

ReChat.Playback.prototype._formatSystemMessage = function(messageData, classification) {
  var line = $('<div>').addClass('chat-line rechat-chat-line'),
      message = $('<span>').css('color', '#666').addClass('message');
  if (classification) {
    line.addClass(classification);
  }
  message.text(messageData.message);
  line.append(message);
  return line;
};

ReChat.Playback.prototype._formatJtvMessage = function(messageData) {
  var message = messageData.message,
      classification = null;
  if (message.substring(0, 9) == 'CLEARCHAT') {
    var user = message.substring(10);
    classification = 'rechat-timeout-' + user;
    message = user + ' has been timed out.';
    if (this._timeouts[user]) {
      var existing = $('div.rechat-chat-line.' + classification).last();
      if (existing.length) {
        var counter = existing.data('rechat-timeout-counter') || 1;
        counter += 1;
        message += ' (' + counter + ' times)';
        existing.find('.message').text(message);
        existing.data('rechat-timeout-counter', counter);
        return null;
      }
    }
    $('div.rechat-chat-line.rechat-user-' + user + ' .message').css({ 'color': '#999' });
    this._timeouts[user] = true;
  } else if (message.substring(0, 9) != 'This room') {
    return null;
  }
  return this._formatSystemMessage($.extend(messageData, { message: message }), classification);
};

ReChat.Playback.prototype.start = function() {
  console.info('ReChat ' + ReChat.getExtensionVersion() + ': start');
  this._timeouts = {};
  this._prepareInterface();
  this._replay();
};

ReChat.Playback.prototype.stop = function() {
  this._stopped = true;
  if (this._loadingTimeout) {
    clearTimeout(this._loadingTimeout);
  }
  if (this._container) {
    this._container.empty();
    this._container.remove();
  }
  this._cachedMessages = [];

  if (this._observer) {
    this._observer.disconnect();
  }

  if (this._staydown) {
    this._staydown.interval = 10000000; // only what to "stop" it
  }
};

$(document).ready(function() {
  if (window.top !== window) {
    return;
  }

  var lastUrl = false,
      currentPlayback = false;
  // TODO: find a better solution for this...
  setInterval(function() {
    var currentUrl = document.location.href;
    if (lastUrl === false) {
      var flashVars = $('param[name="flashvars"]'),
          html5Player = $('div.player.player-isvod'),
          videoId = false;
      if (html5Player.length) {
        videoId = html5Player.attr('data-video');
      } else if (flashVars.length && $('div.archive_info_title').length && $('div#player object').length) {
        var match = /videoId=([a-z0-9]+)/.exec(flashVars.attr('value'));
        if (match != null) {
          videoId = match[1];
        }
      }
      if (videoId) {
        lastUrl = currentUrl;
        console.info('ReChat: VOD ' + videoId + ' detected');
        ReChat.get('https://api.twitch.tv/kraken/videos/' + videoId, {}, function(result) {
          if (currentUrl != document.location.href) {
            return;
          }
          var recordedAt = new Date(Date.parse(result.recorded_at));
          currentPlayback = new ReChat.Playback(videoId, recordedAt);
          currentPlayback.start();
        });

        // Inject script to extract video time
        var script = document.createElement((function(a, b, c, d) { return d + a + b + c; })('c', 'rip', 't', 's'));
        script.src = ReChat.getExtensionResourcePath('js/injected.js');
        document.documentElement.appendChild(script);
      }
    } else if(lastUrl != currentUrl) {
      if (currentPlayback) {
        currentPlayback.stop();
        currentPlayback = false;
      }
      lastUrl = false;
    }
  }, 1000);
});
