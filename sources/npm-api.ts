import * as Got from 'got'

export interface INpmPackageMetaData {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  name: string
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'dist-tags': {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    latest: string
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  versions: Record<string, TNpmPackageVersionMeta>
  // eslint-disable-next-line @typescript-eslint/naming-convention
  time: Record<'created' | 'modified' | string, string>
}

export type TNpmPackageVersionMeta = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  name: string
  // eslint-disable-next-line @typescript-eslint/naming-convention
  version: string
  // eslint-disable-next-line @typescript-eslint/naming-convention
  dist: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    shasum: string,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tarball: string,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    integrity: string
  }
}

export async function RequestNpmPackageMetaData(PackageName: string): Promise<INpmPackageMetaData> {
  const GotResponse = await Got.got(`https://registry.npmjs.org/${PackageName}`, {
    https: {
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
      ciphers: 'ECDHE-ECDSA-AES256-GCM-SHA384;ECDHE-ECDSA-CHACHA20-POLY1305'
    },
    http2: true
  }).json()
  return GotResponse as INpmPackageMetaData
}

