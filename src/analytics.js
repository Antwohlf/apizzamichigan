export function trackSiteSwitch(fromKey, toKey) {
  if (typeof window === 'undefined') return
  const payload = {
    event: 'site_switch_click',
    from_site: fromKey,
    to_site: toKey,
    timestamp: Date.now(),
  }

  if (typeof window.gtag === 'function') {
    window.gtag('event', 'site_switch_click', {
      event_category: 'navigation',
      from_site: fromKey,
      to_site: toKey,
    })
  }

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push(payload)
  }
}
