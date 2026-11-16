// Registration is paused while the site design is being adjusted.
// Remove the old introduction worker and its caches from returning visitors.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(
    registrations.filter(registration => {
      const worker = registration.active || registration.waiting || registration.installing;
      return worker && new URL(worker.scriptURL).pathname === '/sw.js';
    }).map(registration => registration.unregister())
  )).catch(() => {});
}
if ('caches' in window) {
  caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('whiteboard-introduction-')).map(key => caches.delete(key))
  )).catch(() => {});
}

// Rounded outlines keep hero text legible over the image on smaller screens.
const heroMobile = window.matchMedia('(max-width: 760px)');
function updateHeroOutline() {
  Outliner.apply('.hero-heading .eyebrow, .hero-heading .lead, .hero-copy .caption', {
    width: heroMobile.matches ? '8px' : '0px',
    color: '#141917',
    corner: '3px'
  });
}
updateHeroOutline();
heroMobile.addEventListener('change', updateHeroOutline);

// Give each heading a subtle, rounded black outline.
Outliner.apply('h1, h2, h3', { width: '4px', color: '#000', corner: '3px' });
