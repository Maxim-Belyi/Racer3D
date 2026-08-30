export const Sounds = {
  audio: {},
  isPlaying: localStorage.getItem('racerjs_muted') !== 'true',
  isMuted: localStorage.getItem('racerjs_muted') === 'true',

  init() {
    this.audio.main = new Audio('./media/background-music.mp3');
    this.audio.main.volume = 0.4;
    this.audio.main.loop = true;

    this.audio.coin = new Audio('./media/coin.mp3');
    this.audio.coin.volume = 0.3;

    this.audio.arrow = new Audio('./media/engine-force.mp3');
    this.audio.arrow.volume = 0.3;

    this.audio.slow = new Audio('./media/slow.mp3');
    this.audio.slow.volume = 0.5;
  },

  play(name) {
    this.audio[name].play();
  },

  pauseAll() {
    Object.values(this.audio).forEach((audio) => audio.pause());
  },

  resumeAll() {
    if (this.audio.main && !this.isMuted) {
      this.audio.main.play();
    }
  },

  toggleMute() {
    if (this.isPlaying) {
      this.pauseAll();
      this.isPlaying = false;
      this.isMuted = true;
      localStorage.setItem('racerjs_muted', 'true');
    } else if (this.isMuted) {
      this.resumeAll();
      this.isPlaying = true;
      this.isMuted = false;
      localStorage.setItem('racerjs_muted', 'false');
    }  
  },
};
Sounds.init();

