(function() {
    if (window.__kindleHooksInitialized) {
        return;
    }
    window.__kindleHooksInitialized = true;

    var handlerName = 'kindleBridge';
    var renderFragment = '/renderer/render';
    var deviceTokenFragment = '/service/web/register/getDeviceToken';
    var annotationsFragment = 'getAnnotations';

    function postMessage(type, value, extra) {
        if (value === null || value === undefined || value === '') {
            return;
        }
        try {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[handlerName]) {
                var payload = { type: type, value: value };
                if (extra) {
                    for (var key in extra) {
                        if (Object.prototype.hasOwnProperty.call(extra, key)) {
                            payload[key] = extra[key];
                        }
                    }
                }
                window.webkit.messageHandlers[handlerName].postMessage(payload);
            }
        } catch (error) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[KindleBridge] postMessage failed', type, error);
            }
        }
    }

    function extractStartingPositionFromURL(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }
        try {
            var parsed = new URL(url, window.location.origin);
            var value = parsed.searchParams.get('startingPosition');
            if (value) {
                return value;
            }
        } catch (error) {
            // URL constructor can fail for relative URLs; fall back to regex.
        }

        var match = url.match(/[?&]startingPosition=([^&#]+)/i);
        if (match && match[1]) {
            try {
                return decodeURIComponent(match[1]);
            } catch (error) {
                return match[1];
            }
        }
        return null;
    }

    function extractStartingPositionFromText(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }

        // Try JSON first.
        try {
            var data = JSON.parse(text);
            if (data && typeof data === 'object') {
                if (data.startingPosition) {
                    return String(data.startingPosition);
                }
                if (data.query && data.query.startingPosition) {
                    return String(data.query.startingPosition);
                }
            }
        } catch (error) {
            // ignore JSON parse failures; we'll fall back to regex below.
        }

        var match = text.match(/"startingPosition"\s*:\s*"([^"\\]+)"/);
        if (match && match[1]) {
            return match[1];
        }
        match = text.match(/"startingPosition"\s*:\s*(\d+(?:\.\d+)?)/);
        if (match && match[1]) {
            return match[1];
        }
        return null;
    }

    function extractASINFromURL(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }
        try {
            var parsed = new URL(url, window.location.origin);
            var asin = parsed.searchParams.get('asin');
            if (asin) {
                return asin;
            }
        } catch (error) {
            // fallback regex for relative URLs
        }
        var match = url.match(/[?&]asin=([^&#]+)/i);
        if (match && match[1]) {
            try {
                return decodeURIComponent(match[1]);
            } catch (error) {
                return match[1];
            }
        }
        return null;
    }

    function extractDeviceTokenFromURL(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }
        try {
            var parsed = new URL(url, window.location.origin);
            var serial = parsed.searchParams.get('serialNumber');
            if (serial) {
                return serial;
            }
            var token = parsed.searchParams.get('deviceToken');
            if (token) {
                return token;
            }
        } catch (error) {
            // URL constructor can fail for relative URLs; fall back to regex.
        }

        var match = url.match(/[?&](serialNumber|deviceToken)=([^&#]+)/i);
        if (match && match[2]) {
            try {
                return decodeURIComponent(match[2]);
            } catch (error) {
                return match[2];
            }
        }
        return null;
    }

    function extractDeviceTokenFromText(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }
        try {
            var data = JSON.parse(text);
            if (data && typeof data === 'object') {
                if (data.deviceToken) {
                    return data.deviceToken;
                }
                if (data.serialNumber) {
                    return data.serialNumber;
                }
            }
        } catch (error) {
            // ignore parse errors
        }
        var match = text.match(/"(deviceToken|serialNumber)"\s*:\s*"([^"\\]+)"/);
        if (match && match[2]) {
            return match[2];
        }
        return null;
    }

    function normalizeGUIDValue(raw) {
        if (!raw || typeof raw !== 'string') {
            return null;
        }
        var trimmed = raw.trim();
        if (!trimmed) {
            return null;
        }
        var segments = trimmed.split(',');
        // TODO: find root cause of multiple GUID values rather than post-processing here
        var candidate = segments[segments.length - 1].trim();
        var match = candidate.match(/CR![A-Z0-9]+/);
        if (match && match[0]) {
            return match[0];
        }
        return candidate || null;
    }

    function extractGUIDFromURL(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }
        try {
            var parsed = new URL(url, window.location.origin);
            var value = parsed.searchParams.get('guid');
            if (value) {
                return normalizeGUIDValue(value);
            }
        } catch (error) {
            // fallback regex
        }
        var match = url.match(/[?&]guid=([^&#]+)/i);
        if (match && match[1]) {
            var decoded = match[1];
            try {
                decoded = decodeURIComponent(match[1]);
            } catch (error) {
            }
            return normalizeGUIDValue(decoded);
        }
        return null;
    }

    function extractRenderingTokenFromHeaders(headers) {
        if (!headers) {
            return null;
        }
        try {
            if (typeof Headers !== 'undefined' && headers instanceof Headers) {
                return headers.get('x-amz-rendering-token');
            }
        } catch (error) {
            // ignore
        }

        if (Array.isArray(headers)) {
            for (var i = 0; i < headers.length; i++) {
                var entry = headers[i];
                if (Array.isArray(entry) && entry[0] && entry[0].toLowerCase() === 'x-amz-rendering-token') {
                    return entry[1];
                }
            }
        } else if (headers && typeof headers === 'object') {
            for (var key in headers) {
                if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === 'x-amz-rendering-token') {
                    return headers[key];
                }
            }
            if (headers.get && typeof headers.get === 'function') {
                return headers.get('x-amz-rendering-token');
            }
        }

        return null;
    }

    function extractRevisionFromURL(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }
        try {
            var parsed = new URL(url, window.location.origin);
            var revision = parsed.searchParams.get('revision');
            if (revision) {
                return revision;
            }
        } catch (error) {
            // ignore parsing failures
        }
        var match = url.match(/[?&]revision=([^&#]+)/i);
        if (match && match[1]) {
            try {
                return decodeURIComponent(match[1]);
            } catch (error) {
                return match[1];
            }
        }
        return null;
    }

    function handleRendererURL(url) {
        var position = extractStartingPositionFromURL(url);
        postMessage('startingPosition', position);
        var asin = extractASINFromURL(url);
        postMessage('asin', asin);
        var revision = extractRevisionFromURL(url);
        postMessage('rendererRevision', revision);
        postMessage('debugRendererURL', url);
    }

    function logRequest(method, url) {
        if (!url || typeof url !== 'string') {
            return;
        }
        var upper = method ? String(method).toUpperCase() : 'REQUEST';
        postMessage('debugRequest', upper + ' ' + url);
    }

    var originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = function(input, init) {
            var promise = originalFetch.apply(this, arguments);
            try {
                var url = '';
                if (typeof input === 'string') {
                    url = input;
                } else if (input && typeof input === 'object' && input.url) {
                    url = input.url;
                }

                var method = (init && init.method) || (input && input.method) || 'FETCH';
                logRequest(method, url);

                if (typeof url === 'string' && url.indexOf(renderFragment) !== -1) {
                    handleRendererURL(url);

                     var headerToken = extractRenderingTokenFromHeaders(init && init.headers);
                     if (!headerToken && input && input.headers) {
                        headerToken = extractRenderingTokenFromHeaders(input.headers);
                     }
                     postMessage('renderingToken', headerToken, { url: url });

                    if (promise && typeof promise.then === 'function') {
                        promise = promise.then(function(response) {
                            try {
                                if (response && typeof response.clone === 'function') {
                                    response.clone().text().then(function(text) {
                                        var position = extractStartingPositionFromText(text);
                                        postMessage('startingPosition', position);
                                    });
                                    if (response.headers && response.headers.get) {
                                        var headerToken = response.headers.get('x-amz-rendering-token');
                                        postMessage('renderingToken', headerToken, { url: url });
                                    }
                                }
                            } catch (error) {
                                if (typeof console !== 'undefined' && console.error) {
                                    console.error('[KindleBridge] fetch inspection failed', error);
                                }
                            }
                            return response;
                        });
                    }
                } else if (typeof url === 'string' && url.indexOf(deviceTokenFragment) !== -1) {
                    var tokenFromURL = extractDeviceTokenFromURL(url);
                    postMessage('deviceToken', tokenFromURL);

                    if (promise && typeof promise.then === 'function') {
                        promise = promise.then(function(response) {
                            try {
                                if (response && typeof response.clone === 'function') {
                                    response.clone().text().then(function(text) {
                                        var token = extractDeviceTokenFromText(text);
                                        postMessage('deviceToken', token);
                                    });
                                }
                            } catch (error) {
                                if (typeof console !== 'undefined' && console.error) {
                                    console.error('[KindleBridge] deviceToken fetch inspection failed', error);
                                }
                            }
                            return response;
                        });
                    }
                } else if (typeof url === 'string' && url.indexOf(annotationsFragment) !== -1) {
                    var guid = extractGUIDFromURL(url);
                    postMessage('guid', guid);
                }
            } catch (error) {
                if (typeof console !== 'undefined' && console.error) {
                    console.error('[KindleBridge] fetch override failed', error);
                }
            }
            return promise;
        };
    }

    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    var originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        try {
            this.__kindleRenderTarget = typeof url === 'string' && url.indexOf(renderFragment) !== -1;
            this.__kindleDeviceTarget = typeof url === 'string' && url.indexOf(deviceTokenFragment) !== -1;
            this.__kindleRenderURL = this.__kindleRenderTarget ? url : null;
            if (this.__kindleRenderTarget) {
                handleRendererURL(url);
            }
            if (this.__kindleDeviceTarget) {
                var serial = extractDeviceTokenFromURL(url);
                postMessage('deviceToken', serial);
            }
            if (typeof url === 'string' && url.indexOf(annotationsFragment) !== -1) {
                var guid = extractGUIDFromURL(url);
                postMessage('guid', guid);
            }
            logRequest(method, url);
        } catch (error) {
            this.__kindleRenderTarget = false;
            this.__kindleDeviceTarget = false;
            this.__kindleRenderURL = null;
        }
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try {
            if (this.__kindleRenderTarget && typeof name === 'string' && name.toLowerCase() === 'x-amz-rendering-token') {
                postMessage('renderingToken', value, { url: this.__kindleRenderURL });
            }
        } catch (error) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[KindleBridge] renderingToken xhr setHeader failed', error);
            }
        }
        return originalSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (this.__kindleRenderTarget) {
            this.addEventListener('load', function() {
                try {
                    var position = extractStartingPositionFromText(this.responseText);
                    postMessage('startingPosition', position);
                    if (this.getResponseHeader) {
                        var headerToken = this.getResponseHeader('x-amz-rendering-token');
                        postMessage('renderingToken', headerToken, { url: this.__kindleRenderURL });
                    }
                } catch (error) {
                    if (typeof console !== 'undefined' && console.error) {
                        console.error('[KindleBridge] startingPosition xhr load failed', error);
                    }
                }
            });
        } else if (this.__kindleDeviceTarget) {
            this.addEventListener('load', function() {
                // Response parsing fallback.
                try {
                    var token = extractDeviceTokenFromText(this.responseText);
                    postMessage('deviceToken', token);
                } catch (error) {
                    if (typeof console !== 'undefined' && console.error) {
                        console.error('[KindleBridge] deviceToken xhr load failed', error);
                    }
                }
            });
        }
        return originalSend.apply(this, arguments);
    };
})();
