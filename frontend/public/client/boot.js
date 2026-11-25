// Runs before the client app (client.html): picks the product look for this host, so the tab,
// home-screen icon and install prompt are right from the first paint.
//   bookings.*      Byte Bun Bookings (installable app at /app)
//   clientportal.*  Byte Bun Client Portal (installable)
//   scanner.*       Byte Bun Scanner (installable)
//   accounts.*      Byte Bun Accounts
(function () {
  var label = location.hostname.split('.')[0];
  var surface = label === 'clientportal' ? 'portal' : label === 'accounts' ? 'accounts' : label === 'scanner' ? 'scanner' : 'bookings';
  var product = {
    bookings: { name: 'Byte Bun Bookings', short: 'Bookings', color: '#0F766E', icon: '/client/bookings-icon.svg', manifest: '/client/bookings.webmanifest' },
    portal: { name: 'Byte Bun Client Portal', short: 'Client Portal', color: '#331165', icon: '/client/portal-icon.svg', manifest: '/client/portal.webmanifest' },
    accounts: { name: 'Byte Bun Accounts', short: 'Accounts', color: '#0F766E', icon: '/client/bookings-icon.svg', manifest: null },
    scanner: { name: 'Byte Bun Scanner', short: 'Scanner', color: '#0B0D12', icon: '/client/scanner-icon.svg', manifest: '/client/scanner.webmanifest' },
  }[surface];
  // On the bookings host, the public booking and event pages (/{business}, /manage) belong to the
  // business's customers: no "install Byte Bun Bookings" prompt there.
  var path = location.pathname;
  var appPage = path === '/' || /^\/(app|sign-in)(\/|$)/.test(path);
  var installable = !!product.manifest && (surface !== 'bookings' || appPage);

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
  function meta(name, content) {
    var m = document.createElement('meta');
    m.name = name;
    m.content = content;
    head.appendChild(m);
  }
  link('icon', product.icon, 'image/svg+xml');
  link('apple-touch-icon', product.icon.replace('.svg', '-192.png'));
  var theme = document.querySelector('meta[name=theme-color]');
  if (theme) theme.setAttribute('content', product.color);
  if (installable) {
    link('manifest', product.manifest);
    meta('apple-mobile-web-app-title', product.short);
    meta('mobile-web-app-capable', 'yes');
  }
  // The browser's install prompt can fire before the app has loaded: keep it for the app's
  // "Install app" button (client/components/InstallApp.jsx).
  window.__bbInstallable = installable;
  if (installable) {
    addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      window.__bbInstallPrompt = e;
      dispatchEvent(new Event('bb-installable'));
    });
    addEventListener('appinstalled', function () {
      window.__bbInstallPrompt = null;
      dispatchEvent(new Event('bb-installable'));
    });
  }
  // Installable app: a service worker (network first, offline notice).
  if (installable && 'serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
