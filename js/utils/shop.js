import { Storage } from './storage.js';
import { CAR_CATALOG, CAR_CLASSES, getCarById } from './car-catalog.js';

export const UPGRADES = [
  {
    id: 'unlock_magnet',
    type: 'unlock',
    icon: '🧲',
    name: 'Магнит монет',
    desc: 'Добавляет на дорогу магниты!',
    price: 300,
  },
  {
    id: 'consumable_life',
    type: 'consumable',
    icon: '❤️',
    name: 'Дополнительная жизнь',
    desc: 'Продолжить игру после столкновения (Максимум 3)',
    price: 150,
  },
  {
    id: 'coin_upgrade',
    type: 'levelup',
    icon: '🪙',
    name: 'Монетный магнат',
    desc: 'Каждый уровень добавляет +1 монету на дорогу во время заезда.',
    pricePerLevel: 40,
    maxLevel: 10,
    stateKey: 'coinUpgradeLevel',
  },
  {
    id: 'speed_upgrade',
    type: 'levelup',
    icon: '⚡',
    name: 'Турбо-двигатель',
    desc: 'Каждый уровень увеличивает скорость машины на 2%.',
    prices: [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000],
    maxLevel: 10,
    stateKey: 'speedUpgradeLevel',
  },
];

export function initShop() {
  const shopModal = document.querySelector('[data-js-shop-modal]');
  const shopContent = document.querySelector('[data-js-shop-content]');
  const shopCoins = document.querySelector('[data-js-shop-coins]');
  
  const openButtons = document.querySelectorAll('[data-js-open-shop]');
  const closeButton = document.querySelector('[data-js-close-shop]');
  const tabButtons = document.querySelectorAll('[data-js-shop-tab]');

  let activeTab = 'garage';

  openButtons.forEach(btn => btn.addEventListener('click', () => {
    renderShop();
    shopModal.style.display = 'flex';
  }));

  closeButton.addEventListener('click', () => {
    shopModal.style.display = 'none';
  });

  tabButtons.forEach(btn => btn.addEventListener('click', (e) => {
    activeTab = e.target.getAttribute('data-js-shop-tab');
    tabButtons.forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    renderShop();
  }));

  function renderShop() {
    const state = Storage.get();
    shopCoins.innerText = state.totalCoins;
    shopContent.innerHTML = '';

    if (activeTab === 'garage') {
      shopContent.classList.add('shop-modal__content--grid');
      renderGarage(state);
    } else {
      shopContent.classList.remove('shop-modal__content--grid');
      renderUpgrades(state);
    }
  }

  function renderGarage(state) {
    let currentClass = null;

    CAR_CATALOG.forEach(car => {
      if (car.class !== currentClass) {
        currentClass = car.class;
        const clsInfo = CAR_CLASSES[currentClass];
        const titleEl = document.createElement('div');
        titleEl.className = 'shop-category-title';
        titleEl.innerHTML = `
          <span>${clsInfo.label}</span>
          <span class="modifier">${clsInfo.desc}</span>
        `;
        shopContent.appendChild(titleEl);
      }

      const el = document.createElement('div');
      
      let isBought = car.free || state.purchasedCars.includes(car.id);
      let isSelected = state.selectedCar === car.id;
      let buttonText = car.free ? 'Бесплатно' : `Купить (${car.price})`;
      let canAfford = state.totalCoins >= car.price;
      let buttonClass = 'shop-item__button';
      let disabled = !canAfford;

      if (isBought) {
        buttonText = isSelected ? 'Выбрано' : 'Выбрать';
        disabled = isSelected;
        canAfford = true;
        if (isSelected) buttonClass += ' shop-item__button--selected';
      }

      el.className = `shop-item shop-item--card ${isSelected ? 'shop-item--selected' : ''}`;
      
      const iconHtml = car.img 
        ? `<img src="./images/${car.img}" class="shop-item__icon" alt="${car.name}">`
        : `<img src="./images/car.png" class="shop-item__icon" alt="Default">`;

      el.innerHTML = `
        <div class="shop-item__info">
            ${iconHtml}
            <div class="shop-item__text">
                <span class="shop-item__name">${car.name}</span>
            </div>
        </div>
        <div class="shop-item__action">
            <button class="${buttonClass}" ${disabled ? 'disabled' : ''}>${buttonText}</button>
        </div>
      `;

      const btn = el.querySelector('button');
      btn.addEventListener('click', () => {
        if (isBought) {
          state.selectedCar = car.id;
          Storage.save(state);
          renderShop();
          applySkin(car.id);
        } else if (state.totalCoins >= car.price) {
          state.totalCoins -= car.price;
          state.purchasedCars.push(car.id);
          state.selectedCar = car.id;
          Storage.save(state);
          renderShop();
          applySkin(car.id);
        }
      });

      shopContent.appendChild(el);
    });
  }

  function renderUpgrades(state) {
    UPGRADES.forEach(item => {
      const el = document.createElement('div');
      el.className = 'shop-item';

      let iconHtml = `<div class="shop-item__icon" style="display:flex;align-items:center;justify-content:center;font-size:2rem;">${item.icon}</div>`;
      let buttonText = `${item.price} 🪙`;
      let disabled = false;
      let extraHtml = '';
      let isBought = false;

      if (item.type === 'unlock') {
        isBought = item.id === 'unlock_magnet' ? state.hasMagnet : false;
        const canAfford = state.totalCoins >= item.price;
        disabled = isBought || !canAfford;
        if (isBought) buttonText = '✅ Разблокировано';
        else buttonText = `${item.price} 🪙`;
      }

      else if (item.type === 'consumable') {
        const count = state.extraLives || 0;
        const atMax  = count >= 3;
        const canAfford = state.totalCoins >= item.price;
        disabled = atMax || !canAfford;
        if (atMax) buttonText = `✅ Максимум`;
        else buttonText = `${item.price} 🪙 — имеется: ${count}/3`;
      }

      else if (item.type === 'levelup') {
        const currentLevel = state[item.stateKey] || 0;
        const atMax = currentLevel >= item.maxLevel;

        let nextPrice;
        if (item.prices) {
          nextPrice = item.prices[currentLevel] ?? null; 
        } else {
          nextPrice = atMax ? null : item.pricePerLevel;
        }

        const canAfford = nextPrice !== null && state.totalCoins >= nextPrice;
        disabled = atMax || !canAfford;

        if (atMax) {
          buttonText = `✅ Максимум (${currentLevel}/${item.maxLevel})`;
        } else {
          buttonText = `${nextPrice} 🪙`;
        }

        const pct = Math.round((currentLevel / item.maxLevel) * 100);
        const dots = Array.from({ length: item.maxLevel }, (_, i) =>
          `<span class="upgrade-dot ${i < currentLevel ? 'filled' : ''}"></span>`
        ).join('');

        extraHtml = `
          <div class="shop-item__upgrade-progress">
            <div class="upgrade-dots">${dots}</div>
            <span class="upgrade-level-text">Ур. ${currentLevel} / ${item.maxLevel}</span>
          </div>
        `;
      }

      el.innerHTML = `
        <div class="shop-item__info">
            ${iconHtml}
            <div class="shop-item__text">
                <span class="shop-item__name">${item.name}</span>
                <span class="shop-item__desc">${item.desc}</span>
                ${extraHtml}
            </div>
        </div>
        <div class="shop-item__action">
            <button class="shop-item__button" ${disabled ? 'disabled' : ''}>${buttonText}</button>
        </div>
      `;

      const btn = el.querySelector('button');
      btn.addEventListener('click', () => {
        if (disabled) return;

        if (item.type === 'unlock') {
          if (state.totalCoins >= item.price) {
            state.totalCoins -= item.price;
            if (item.id === 'unlock_magnet') state.hasMagnet = true;
            Storage.save(state);
            renderShop();
          }
        } else if (item.type === 'consumable') {
          if (state.totalCoins >= item.price && (state.extraLives || 0) < 3) {
            state.totalCoins -= item.price;
            state.extraLives = (state.extraLives || 0) + 1;
            Storage.save(state);
            renderShop();
          }
        } else if (item.type === 'levelup') {
          const currentLevel = state[item.stateKey] || 0;
          if (currentLevel >= item.maxLevel) return;
          const nextPrice = item.prices ? item.prices[currentLevel] : item.pricePerLevel;
          if (state.totalCoins >= nextPrice) {
            state.totalCoins -= nextPrice;
            state[item.stateKey] = currentLevel + 1;
            Storage.save(state);
            renderShop();
          }
        }
      });

      shopContent.appendChild(el);
    });
  }
}

export function applySkin(carId) {
  window.dispatchEvent(new CustomEvent('car-changed', { detail: { carId } }));
}
