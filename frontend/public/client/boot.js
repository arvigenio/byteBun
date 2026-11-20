// Runs before the client app (client.html): picks the product look for this host, so the tab,
// home-screen icon and install prompt are right from the first paint.
//   bookings.*      Byte Bun Bookings (standalone app, installable)
//   clientportal.*  Byte Bun Client Portal (installable)
//   accounts.*      Byte Bun Accounts
(function () {
  var label = location.hostname.split('.')[0];
  var surface = label === 'clientportal' ? 'portal' : label === 'accounts' ? 'accounts' : 'bookings';
  var product = {
    bookings: { name: 'Byte Bun Bookings', color: '#0F766E', icon: '/client/bookings-icon.svg', manifest: '/client/bookings.webmanifest' },
    portal: { name: 'Byte Bun Client Portal', color: '#331165', icon: '/client/portal-icon.svg', manifest: '/client/portal.webmanifest' },
    accounts: { name: 'Byte Bun Accounts', color: '#0F766E', icon: '/client/bookings-icon.svg', manifest: null },
  }[surface];
  document.documentElement.dataset.surface = surface;
  document.title = product.name;
  var head = document.head;
  function link(rel, href, type) {
    var l = document.createElement('link');
    l.rel = rel;
    l.href = href;
    if (type) l.type = type;
    head.appendChild(l);
  }
  link('icon', product.icon, 'image/svg+xml');
  link('apple-touch-icon', product.icon.replace('.svg', '-192.png'));
  if (product.manifest) link('manifest', product.manifest);
  var theme = document.querySelector('meta[name=theme-color]');
  if (theme) theme.setAttribute('content', product.color);
  // Installable app: a service worker (network first, offline notice).
  if (product.manifest && 'serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
