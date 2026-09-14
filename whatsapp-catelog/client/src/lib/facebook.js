/**
 * Meta Embedded Signup, browser half.
 *
 * The only thing this file is allowed to obtain is a short-lived
 * authorization `code`. It is posted to our server, which exchanges it for an
 * access token using the app secret. No token, and no app secret, ever exists
 * in this bundle.
 */

let sdkPromise = null;

/** Loads the Facebook JS SDK once, and resolves when FB is ready. */
export function loadFacebookSdk({ appId, graphVersion }) {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }

    window.fbAsyncInit = () => {
      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version: graphVersion,
      });
      resolve(window.FB);
    };

    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Could not load the Meta SDK. Check your connection or ad blocker.'));
    };
    document.body.appendChild(script);
  });

  return sdkPromise;
}

/**
 * Meta posts the selected WABA and phone number to the opener as a
 * `WA_EMBEDDED_SIGNUP` message. Those ids are hints only - the server
 * re-inspects the token before trusting them.
 */
export function listenForSignupEvents(onEvent) {
  const handler = (event) => {
    if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;

    try {
      const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return;
      onEvent(payload);
    } catch {
      // Unrelated postMessage traffic; ignore.
    }
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/**
 * Opens Meta's onboarding window.
 * Resolves with { code } on success, or rejects when the user cancels.
 */
export function launchEmbeddedSignup({ configId, scopes }) {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error('The Meta SDK is not ready yet. Try again in a moment.'));
      return;
    }

    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (code) {
          resolve({ code });
          return;
        }
        reject(new Error('Connection was cancelled before it finished.'));
      },
      {
        config_id: configId,
        // `code` keeps the token exchange on the server where the secret lives.
        response_type: 'code',
        override_default_response_type: true,
        scope: scopes.join(','),
        // Coexistence: onboard a number that already runs the WhatsApp Business
        // app, keeping the app working, instead of asking for a fresh number.
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      },
    );
  });
}
