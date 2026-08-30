import { YandexAds } from './yandex-ads.js';

const STORAGE_KEY = 'racerjs_save';

const defaultState = {
  totalCoins: 0,
  selectedCar: 'default',
  purchasedCars: ['default'], 
  hasMagnet: false,
  extraLives: 0,
  speedLevel: 1,
  gameLevel: 1,
  coinUpgradeLevel: 0,   // +1 coin on road per level, costs 40 each
  speedUpgradeLevel: 0,  // +2% player speed per level, max 4 levels
};

// In-memory cache for synchronous reads/writes
let cachedState = null;

export const Storage = {
  /**
   * Initializes the storage. Fetches from Yandex Cloud if available, 
   * falls back to localStorage, and handles migration.
   */
  async init() {
    let localData = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        localData = JSON.parse(saved);
        if (localData.selectedCar === 'blue') localData.selectedCar = 'default';
        if (localData.purchasedCars) {
          localData.purchasedCars = localData.purchasedCars.map(c => c === 'blue' ? 'default' : c);
        }
      }
    } catch (e) {
      console.warn('Error reading from localStorage', e);
    }

    if (YandexAds.player) {
      try {
        const cloudData = await YandexAds.player.getData();
        if (Object.keys(cloudData).length === 0) {
          // No cloud data. If we have local data, migrate it to the cloud.
          if (localData) {
            console.info('[Storage] Migrating local data to Yandex Cloud...');
            cachedState = { ...defaultState, ...localData };
            YandexAds.player.setData(cachedState).catch(e => console.warn('Cloud migration failed', e));
          } else {
            cachedState = { ...defaultState };
          }
        } else {
          // Cloud data exists, use it.
          console.info('[Storage] Loaded data from Yandex Cloud');
          cachedState = { ...defaultState, ...cloudData };
        }
      } catch (err) {
        console.warn('[Storage] Failed to get cloud data, using fallback.', err);
        cachedState = { ...defaultState, ...(localData || {}) };
      }
    } else {
      // Standalone mode or SDK unavailable
      cachedState = { ...defaultState, ...(localData || {}) };
    }
  },

  get() {
    // If somehow get is called before init(), provide a fallback
    if (!cachedState) {
      console.warn('[Storage] get() called before init()!');
      return { ...defaultState };
    }
    return cachedState;
  },

  save(state) {
    cachedState = state;
    
    // Save to localStorage as a fallback
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Error saving to localStorage', e);
    }

    // Save to Yandex Cloud asynchronously (fire and forget)
    if (YandexAds.player) {
      YandexAds.player.setData(state).catch(e => {
        console.warn('[Storage] Error saving to Yandex Cloud', e);
      });
    }
  },

  addCoins(amount) {
    const state = this.get();
    state.totalCoins += amount;
    this.save(state);
  },

  spendCoins(amount) {
    const state = this.get();
    if (state.totalCoins >= amount) {
      state.totalCoins -= amount;
      this.save(state);
      return true;
    }
    return false;
  }
};
