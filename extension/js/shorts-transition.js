// shorts-transition.js - Shared bounded transition coordinator for Shorts
// Depends on: the DOM and the later navigateToNextShort() helper.

const shortsTransitionDeveloperLogger = typeof DeveloperLogger !== 'undefined'
    ? DeveloperLogger.create('content', 'shorts-transition')
    : null;

const SHORTS_TRANSITION_RETRY_DELAYS = Object.freeze([0, 80, 180, 360, 720, 1400]);

const SHORTS_TRANSITION_STATE = {
    byRenderer: new WeakMap(),
    states: new Set(),
    listenersInstalled: false
};

function shortsTransitionIsConnected(renderer) {
    if (!renderer) return false;
    if (typeof document !== 'undefined' && typeof document.contains === 'function') {
        try {
            return document.contains(renderer);
        } catch (_) { }
    }
    return renderer.isConnected !== false;
}

function shortsTransitionNormalizeFingerprint(value) {
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : String(value);
}

function shortsTransitionStateIsCurrent(state) {
    if (!state || !shortsTransitionIsConnected(state.renderer)) return false;
    if (!state.checks.size) return true;

    // A renderer may be excluded for two simultaneous reasons (for example an
    // ad marker and a locally blocked channel). One current reason is enough to
    // keep the shared transition alive; each feature releases its own reason
    // when its marker disappears.
    for (const check of state.checks.values()) {
        try {
            if (check()) return true;
        } catch (_) { }
    }
    return false;
}

function shortsTransitionRemoveState(state) {
    if (!state) return;
    if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    SHORTS_TRANSITION_STATE.states.delete(state);
    if (SHORTS_TRANSITION_STATE.byRenderer.get(state.renderer) === state) {
        SHORTS_TRANSITION_STATE.byRenderer.delete(state.renderer);
    }
}

function shortsTransitionInvokeNavigation() {
    if (typeof navigateToNextShort !== 'function') return false;
    try {
        return navigateToNextShort() !== false;
    } catch (_) {
        shortsTransitionDeveloperLogger?.error('shorts.navigation_failed', 'Shorts transition navigation failed.');
        return false;
    }
}

function shortsTransitionNotifyAction(state) {
    if (!state.navigationIssued) return;
    for (const [reason, callback] of state.actionCallbacks) {
        if (state.notifiedReasons.has(reason) || typeof callback !== 'function') continue;
        state.notifiedReasons.add(reason);
        try {
            callback({
                renderer: state.renderer,
                fingerprint: state.fingerprint,
                reason
            });
        } catch (_) { }
    }
}

function shortsTransitionScheduleAttempt(state) {
    if (!state || state.timer !== null || state.exhausted ||
        state.attempt >= SHORTS_TRANSITION_RETRY_DELAYS.length) return;

    const delay = SHORTS_TRANSITION_RETRY_DELAYS[state.attempt];
    state.timer = setTimeout(() => {
        state.timer = null;

        if (SHORTS_TRANSITION_STATE.byRenderer.get(state.renderer) !== state ||
            !shortsTransitionStateIsCurrent(state)) {
            shortsTransitionRemoveState(state);
            return;
        }

        // Only one navigation action is ever issued for one renderer/fingerprint.
        // The remaining bounded slots are observation windows for YouTube's SPA
        // renderer recycling, not repeated clicks or keyboard events.
        if (!state.actionAttempted) {
            state.actionAttempted = true;
            state.navigationIssued = shortsTransitionInvokeNavigation();
            shortsTransitionNotifyAction(state);
        }

        state.attempt += 1;
        if (!shortsTransitionStateIsCurrent(state)) {
            shortsTransitionRemoveState(state);
            return;
        }
        if (state.attempt >= SHORTS_TRANSITION_RETRY_DELAYS.length) {
            // Retain the completed fingerprint lock while the renderer stays
            // alive. Repeated mutation passes must not start another action
            // for the same Short; a new fingerprint or released reason clears
            // this state.
            state.exhausted = true;
            return;
        }

        shortsTransitionScheduleAttempt(state);
    }, delay);
}

function scheduleShortsInvisibleTransition(renderer, options = {}) {
    if (!renderer || typeof options !== 'object') return null;

    const fingerprint = shortsTransitionNormalizeFingerprint(options.fingerprint);
    if (!fingerprint) return null;

    let state = SHORTS_TRANSITION_STATE.byRenderer.get(renderer);
    if (state && state.fingerprint !== fingerprint) {
        shortsTransitionRemoveState(state);
        state = null;
    }

    if (!state) {
        state = {
            renderer,
            fingerprint,
            attempt: 0,
            timer: null,
            actionAttempted: false,
            navigationIssued: false,
            exhausted: false,
            reasons: new Set(),
            checks: new Map(),
            actionCallbacks: new Map(),
            notifiedReasons: new Set()
        };
        SHORTS_TRANSITION_STATE.byRenderer.set(renderer, state);
        SHORTS_TRANSITION_STATE.states.add(state);
    }

    const reason = String(options.reason || 'unknown');
    state.reasons.add(reason);
    if (typeof options.isCurrent === 'function') state.checks.set(reason, options.isCurrent);
    if (typeof options.onTransition === 'function') state.actionCallbacks.set(reason, options.onTransition);
    shortsTransitionScheduleAttempt(state);
    return state;
}

function cancelShortsInvisibleTransition(renderer, fingerprint) {
    if (!renderer) return false;
    const state = SHORTS_TRANSITION_STATE.byRenderer.get(renderer);
    if (!state) return false;
    if (fingerprint !== undefined &&
        state.fingerprint !== shortsTransitionNormalizeFingerprint(fingerprint)) return false;
    shortsTransitionRemoveState(state);
    return true;
}

// Feature modules use this internal helper when only their own exclusion reason
// disappears. It prevents an ad from cancelling a still-valid channel block.
function releaseShortsInvisibleTransitionReason(renderer, fingerprint, reason) {
    const state = SHORTS_TRANSITION_STATE.byRenderer.get(renderer);
    if (!state || (fingerprint !== undefined &&
        state.fingerprint !== shortsTransitionNormalizeFingerprint(fingerprint))) return false;

    const key = String(reason || 'unknown');
    state.reasons.delete(key);
    state.checks.delete(key);
    state.actionCallbacks.delete(key);
    state.notifiedReasons.delete(key);
    if (!state.reasons.size) {
        shortsTransitionRemoveState(state);
    } else if (!shortsTransitionStateIsCurrent(state)) {
        shortsTransitionRemoveState(state);
    }
    return true;
}

function resetShortsInvisibleTransitions() {
    Array.from(SHORTS_TRANSITION_STATE.states).forEach(shortsTransitionRemoveState);
}

function isShortsTransitionCurrent(renderer, fingerprint) {
    const state = SHORTS_TRANSITION_STATE.byRenderer.get(renderer);
    if (!state || state.fingerprint !== shortsTransitionNormalizeFingerprint(fingerprint)) return false;
    return shortsTransitionStateIsCurrent(state);
}

function reevaluateShortsInvisibleTransitions() {
    Array.from(SHORTS_TRANSITION_STATE.states).forEach(state => {
        if (!shortsTransitionStateIsCurrent(state)) {
            shortsTransitionRemoveState(state);
        } else {
            shortsTransitionScheduleAttempt(state);
        }
    });
}

function initializeShortsTransitionCoordinator() {
    if (SHORTS_TRANSITION_STATE.listenersInstalled || typeof document === 'undefined') return;
    SHORTS_TRANSITION_STATE.listenersInstalled = true;
    document.addEventListener('yt-navigate-finish', reevaluateShortsInvisibleTransitions);
    if (typeof window !== 'undefined') {
        window.addEventListener('popstate', reevaluateShortsInvisibleTransitions);
    }
}

initializeShortsTransitionCoordinator();
