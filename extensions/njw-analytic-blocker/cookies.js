const TRACKING = /^(_ga|_gid|_gat|_gac_|_gcl_|_gads|__gads|__gpi|_gl$|gclid|gclsrc|_fbp|_fbc|IDE$|ins-|insdr|spUID|_insider)/

const onSite = (host, sites) => sites.some((s) => host === s || host.endsWith(`.${s}`))

function isTracking(cookie, sites) {
  return onSite(cookie.domain.replace(/^\./, ''), sites) && TRACKING.test(cookie.name)
}

if (typeof module !== 'undefined') module.exports = { isTracking, onSite }
