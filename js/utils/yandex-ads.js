/**
 * Yandex Games SDK wrapper.
 * Docs: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about
 *       https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
 *       https://yandex.ru/dev/games/doc/ru/sdk/sdk-game-events
 *
 * SDK connection (game uploaded to Yandex server — recommended):
 *   <script src="/sdk.js"></script>
 * SDK connection (own domain / iframe):
 *   <script src="https://yandex.ru/games/sdk/v2"></script>
 */

let ysdk = null;
let sdkReady = false;
let ysdkPlayer = null;

export const YandexAds = {
  /** The initialized ysdk instance (null until init completes). */
  get sdk() { return ysdk; },

  /** Initialize SDK. Call once at app start, before any other SDK usage. */
  async init() {
    if (typeof YaGames === 'undefined') {
      console.info('[YandexAds] YaGames not found — standalone mode, rewards will be simulated.');
      return;
    }
    try {
      ysdk = await YaGames.init();
      sdkReady = true;
      console.info('[YandexAds] SDK ready. Lang:', ysdk.environment?.i18n?.lang);
      
      try {
        // scopes: false requests the player object without showing an auth dialog
        ysdkPlayer = await ysdk.getPlayer({ scopes: false });
        console.info('[YandexAds] Player API initialized');
      } catch (pe) {
        console.warn('[YandexAds] Player API failed:', pe);
      }
    } catch (e) {
      console.warn('[YandexAds] SDK init failed:', e);
    }
  },

  /** True when SDK is initialized and available. */
  get isAvailable() {
    return sdkReady && ysdk !== null;
  },

  /** The player object if available. */
  get player() {
    return ysdkPlayer;
  },

  /**
   * Notify Yandex platform that the game has loaded and the player can start.
   * Call this when the welcome/start screen is fully shown (§1.19.2).
   */
  notifyReady() {
    if (!this.isAvailable) return;
    ysdk.features.LoadingAPI?.ready();
  },

  /**
   * Notify platform that active gameplay has started (§1.19.3).
   * Call when: level starts, game resumes, ad closes.
   */
  gameplayStart() {
    if (!this.isAvailable) return;
    ysdk.features.GameplayAPI?.start();
  },

  /**
   * Notify platform that gameplay has stopped (§1.19.3).
   * Call when: level ends, menu opens, ad is about to show, tab loses focus.
   */
  gameplayStop() {
    if (!this.isAvailable) return;
    ysdk.features.GameplayAPI?.stop();
  },

  /**
   * Get the current user language from the SDK environment.
   * Returns null when SDK is not available (local dev).
   * @returns {string|null} e.g. "ru", "en"
   */
  getLang() {
    if (!this.isAvailable) return null;
    return ysdk.environment?.i18n?.lang ?? null;
  },

  /**
   * Show rewarded video ad (§4.5).
   * Automatically dispatches 'ya-ad-open' and 'ya-ad-close' DOM events
   * so game.js can pause/resume audio and animation.
   *
   * showRewardedVideo signature from docs:
   *   { onOpen?, onRewarded?, onClose?(wasShown), onError?(error) }
   *
   * @param {object} callbacks
   * @param {Function} [callbacks.onRewarded]
   * @param {Function} [callbacks.onClose]  
   * @param {Function} [callbacks.onError]
   */
  showRewardedAd({ onRewarded, onClose, onError } = {}) {
    if (!this.isAvailable) {
      console.info('[YandexAds] Simulating rewarded ad (SDK not available).');
      document.dispatchEvent(new Event('ya-ad-open'));
      onRewarded?.();
      onClose?.(true);
      document.dispatchEvent(new Event('ya-ad-close'));
      return;
    }

    document.dispatchEvent(new Event('ya-ad-open'));
    this.gameplayStop();

    ysdk.adv.showRewardedVideo({
      onOpen() {
      },
      onRewarded() {
        onRewarded?.();
      },
      onClose(wasShown) {
        onClose?.(wasShown);
        document.dispatchEvent(new Event('ya-ad-close'));
        YandexAds.gameplayStart();
      },
      onError(error) {
        console.warn('[YandexAds] Rewarded ad error:', error);
        onError?.(error);
        document.dispatchEvent(new Event('ya-ad-close'));
        YandexAds.gameplayStart();
      },
    });
  },
};
