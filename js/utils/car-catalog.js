export const CAR_CLASSES = {
  default: {
    label: "Стандарт",
    desc: "Базовая комплектация",
    modifier: 1.0,
    color: "#4a90d9",
  },
  porshe: {
    label: "Спорт",
    desc: "+10% скорость и маневренность",
    modifier: 1.1,
    color: "#9e9e9e",
  },
  sport: {
    label: "Суперкары",
    desc: "+30% скорость и маневренность",
    modifier: 1.3,
    color: "#ff9800",
  },
  premium: {
    label: "Премиум",
    desc: "+50% скорость и маневренность",
    modifier: 1.5,
    color: "#9c27b0",
  },
};

export const CAR_CATALOG = [
  {
    id: "default",
    class: "default",
    name: "Седан",
    img: "cars/sedan.png",
    glb: "models/cars/sedan.glb",
    price: 0,
    free: true,
  },
  {
    id: "car_suv_luxury",
    class: "default",
    name: "Люкс Внедорожник",
    img: "cars/suv-luxury.png",
    glb: "models/cars/suv-luxury.glb",
    price: 50,
  },
  {
    id: "car_suv",
    class: "default",
    name: "Джип",
    img: "cars/suv.png",
    glb: "models/cars/suv.glb",
    price: 50,
  },
  {
    id: "car_truck",
    class: "default",
    name: "Грузовик",
    img: "cars/truck.png",
    glb: "models/cars/truck.glb",
    price: 50,
  },
  {
    id: "car_delivery",
    class: "default",
    name: "Служба доставки",
    img: "cars/delivery.png",
    glb: "models/cars/delivery.glb",
    price: 50,
  },
  // {
  //   id: "car_van",
  //   class: "default",
  //   name: "Фургон",
  //   img: "cars/van.png",
  //   glb: "models/cars/van.glb",
  //   price: 50,
  // },
  {
    id: "car_firetruck",
    class: "default",
    name: "Пожарная машина",
    img: "cars/firetruck.png",
    glb: "models/cars/firetruck.glb",
    price: 50,
  },

  {
    id: "car_hatchback_sports",
    class: "porshe",
    name: "Спорт-Хэтчбек",
    img: "cars/hatchback-sports.png",
    glb: "models/cars/hatchback-sports.glb",
    price: 150,
  },
  {
    id: "car_sedan_sports",
    class: "porshe",
    name: "Спорт-Седан",
    img: "cars/sedan-sports.png",
    glb: "models/cars/sedan-sports.glb",
    price: 150,
  },
  {
    id: "car_taxi",
    class: "porshe",
    name: "Такси",
    img: "cars/taxi.png",
    glb: "models/cars/taxi.glb",
    price: 150,
  },

  {
    id: "car_race_future",
    class: "sport",
    name: "Кибер Болид",
    img: "cars/race-future.png",
    glb: "models/cars/race-future.glb",
    price: 450,
  },
  {
    id: "car_race",
    class: "sport",
    name: "Болид F1",
    img: "cars/race.png",
    glb: "models/cars/race.glb",
    price: 450,
  },
  {
    id: "car_police",
    class: "sport",
    name: "Полиция",
    img: "cars/police.png",
    glb: "models/cars/police.glb",
    price: 450,
  },

  {
    id: "car_kart_oobi",
    class: "premium",
    name: "Карт Oobi",
    img: "cars/kart-oobi.png",
    glb: "models/cars/kart-oobi.glb",
    price: 800,
  },
  {
    id: "car_kart_oopi",
    class: "premium",
    name: "Карт Oopi",
    img: "cars/kart-oopi.png",
    glb: "models/cars/kart-oopi.glb",
    price: 800,
  },
  {
    id: "car_tractor_police",
    class: "premium",
    name: "Полицейский трактор",
    img: "cars/tractor-police.png",
    glb: "models/cars/tractor-police.glb",
    price: 800,
  },
  {
    id: "car_ambulance",
    class: "premium",
    name: "Скорая помощь",
    img: "cars/ambulance.png",
    glb: "models/cars/ambulance.glb",
    price: 800,
  },
];

export function getCarById(id) {
  return CAR_CATALOG.find((c) => c.id === id) ?? CAR_CATALOG[0];
}

export function getCarClass(id) {
  const car = getCarById(id);
  return CAR_CLASSES[car.class] ?? CAR_CLASSES.default;
}
