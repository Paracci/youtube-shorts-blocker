// Shared YouTube URL policy for the standalone download page and MV3 worker.
// The native host repeats this policy independently at the process boundary.
(function (root) {
    'use strict';

    // YouTube video identifiers are currently 11 URL-safe characters. Keeping
    // this strict prevents the native host from being used as a generic URL
    // fetcher when a malformed path is supplied.
    const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
    const MAX_URL_LENGTH = 2048;

    function isYouTubeHost(hostname) {
        const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
        return host === 'youtube.com' ||
            host === 'www.youtube.com' ||
            host === 'm.youtube.com' ||
            host === 'music.youtube.com' ||
            host === 'youtu.be';
    }

    function invalid(reason) {
        return { ok: false, reason };
    }

    function parse(rawValue) {
        if (typeof rawValue !== 'string') return invalid('invalid_type');

        const raw = rawValue.trim();
        if (!raw) return invalid('empty');
        if (raw.length > MAX_URL_LENGTH) return invalid('too_long');

        let url;
        try {
            url = new URL(raw);
        } catch (_) {
            return invalid('invalid_url');
        }

        if (url.protocol !== 'https:') return invalid('https_required');
        if (url.username || url.password) return invalid('credentials_not_allowed');
        if (!isYouTubeHost(url.hostname)) return invalid('youtube_only');
        if (url.searchParams.has('list')) return invalid('playlist_not_allowed');

        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        const segments = url.pathname.split('/').filter(Boolean);
        let videoId = null;

        if (host === 'youtu.be') {
            if (segments.length !== 1) return invalid('video_only');
            videoId = segments[0];
        } else if (segments[0] === 'watch') {
            if (segments.length !== 1) return invalid('video_only');
            videoId = url.searchParams.get('v');
        } else if (segments[0] === 'shorts' || segments[0] === 'embed') {
            if (segments.length !== 2) return invalid('video_only');
            videoId = segments[1];
        } else {
            return invalid('video_only');
        }

        if (!VIDEO_ID_PATTERN.test(String(videoId || ''))) {
            return invalid('invalid_video_id');
        }

        return {
            ok: true,
            videoId,
            inputUrl: raw,
            canonicalUrl: 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId)
        };
    }

    root.DownloadPolicy = Object.freeze({
        MAX_URL_LENGTH,
        VIDEO_ID_PATTERN,
        isYouTubeHost,
        parse
    });
})(globalThis);
