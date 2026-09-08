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
   */
  notifyReady() {
    if (!this.isAvailable) return;
    try {
      ysdk.features.LoadingAPI?.ready();
    } catch (e) {
      console.warn('[YandexAds] LoadingAPI ready failed:', e);
    }
  },

  /**
   * Notify platform that active gameplay has started.
   */
  gameplayStart() {
    if (!this.isAvailable) return;
    try {
      ysdk.features.GameplayAPI?.start();
    } catch (e) {
      console.warn('[YandexAds] GameplayAPI start failed:', e);
    }
  },

  /**
   * Notify platform that gameplay has stopped.
   */
  gameplayStop() {
    if (!this.isAvailable) return;
    try {
      ysdk.features.GameplayAPI?.stop();
    } catch (e) {
      console.warn('[YandexAds] GameplayAPI stop failed:', e);
    }
  },

  /**
   * Get the current user language from the SDK environment.
   * @returns {string|null} e.g. "ru", "en"
   */
  getLang() {
    if (!this.isAvailable) return null;
    return ysdk.environment?.i18n?.lang ?? null;
  },

  /**
   * Show rewarded video ad (§4.5).
   * Yandex Games SDK v2 requires `callbacks: { onOpen, onRewarded, onClose, onError }`.
   *
   * @param {object} options
   * @param {Function} [options.onRewarded]
   * @param {Function} [options.onClose]
   * @param {Function} [options.onError]
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

    let rewardedGranted = false;

    try {
      ysdk.adv.showRewardedVideo({
        callbacks: {
          onOpen() {
            console.info('[YandexAds] Rewarded ad opened.');
          },
          onRewarded() {
            console.info('[YandexAds] Rewarded ad reward granted.');
            rewardedGranted = true;
            onRewarded?.();
          },
          onClose(wasShown) {
            console.info('[YandexAds] Rewarded ad closed. wasShown:', wasShown);
            onClose?.(rewardedGranted || wasShown);
            document.dispatchEvent(new Event('ya-ad-close'));
            YandexAds.gameplayStart();
          },
          onError(error) {
            console.warn('[YandexAds] Rewarded ad error:', error);
            onError?.(error);
            onClose?.(false);
            document.dispatchEvent(new Event('ya-ad-close'));
            YandexAds.gameplayStart();
          },
        },
      });
    } catch (err) {
      console.warn('[YandexAds] showRewardedVideo call threw exception:', err);
      onError?.(err);
      onClose?.(false);
      document.dispatchEvent(new Event('ya-ad-close'));
      YandexAds.gameplayStart();
    }
  },

  /**
   * Show interstitial fullscreen ad (§4.4).
   * @param {object} options
   * @param {Function} [options.onClose]
   * @param {Function} [options.onError]
   */
  showFullscreenAd({ onClose, onError } = {}) {
    if (!this.isAvailable) {
      console.info('[YandexAds] Simulating interstitial ad (SDK not available).');
      onClose?.(true);
      return;
    }

    document.dispatchEvent(new Event('ya-ad-open'));
    this.gameplayStop();

    try {
      ysdk.adv.showFullscreenAdv({
        callbacks: {
          onClose(wasShown) {
            onClose?.(wasShown);
            document.dispatchEvent(new Event('ya-ad-close'));
            YandexAds.gameplayStart();
          },
          onError(error) {
            console.warn('[YandexAds] Fullscreen ad error:', error);
            onError?.(error);
            onClose?.(false);
            document.dispatchEvent(new Event('ya-ad-close'));
            YandexAds.gameplayStart();
          },
        },
      });
    } catch (err) {
      console.warn('[YandexAds] showFullscreenAdv call threw exception:', err);
      onError?.(err);
      onClose?.(false);
      document.dispatchEvent(new Event('ya-ad-close'));
      YandexAds.gameplayStart();
    }
  },
};
