export type NetKey = 'calibnet' | 'mainnet'

// Where each network's data repo is served from. Locally the dev server maps /data/<net>/ to the
// sibling data repos; a deployed build points these at the published repos.
export const NETWORKS: Record<NetKey, { label: string; base: string }> = {
  calibnet: { label: 'calibnet', base: import.meta.env.VITE_DATA_BASE_CALIBNET ?? '/data/calibnet/' },
  mainnet: { label: 'mainnet', base: import.meta.env.VITE_DATA_BASE_MAINNET ?? '/data/mainnet/' },
}

export function netFromUrl(): NetKey {
  const net = new URLSearchParams(window.location.search).get('net')
  return net === 'mainnet' ? 'mainnet' : 'calibnet'
}
