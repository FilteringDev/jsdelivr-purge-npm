import type { HTTPSRequestOptions } from '@typescriptprime/securereq'
import { RequestJSON, type RequestOptionsType } from './http.js'

export interface INpmPackageMetaData {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  name: string
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'dist-tags': Record<'latest' | string, TNpmTag>,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  versions: Record<TNpmTag | string, TNpmPackageVersionMeta>
  // eslint-disable-next-line @typescript-eslint/naming-convention
  time: Record<'created' | 'modified' | string, string>
}

export type TNpmTag = string

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

const PackageNameRegExp = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu
const NpmRegistryTLSOptions = {
  IsHTTPSEnforced: true,
  MinTLSVersion: 'TLSv1.2',
  MaxTLSVersion: 'TLSv1.2',
  KeyExchanges: ['X25519', 'P-256'],
  Ciphers: [
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305'
  ]
} satisfies HTTPSRequestOptions['TLS']

export function ValidatePackageName(PackageName: string): string {
  if (!PackageNameRegExp.test(PackageName)) {
    throw new Error(`Invalid npm package name: ${PackageName}`)
  }

  return PackageName
}

export function GetNpmRegistryURL(): URL {
  return new URL(process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL ?? 'https://registry.npmjs.org/')
}

export function BuildNpmPackageMetadataURL(PackageName: string): URL {
  const RegistryURL = GetNpmRegistryURL()
  const URLInstance = new URL(RegistryURL)
  URLInstance.pathname = `${RegistryURL.pathname.replace(/\/$/u, '')}/${encodeURIComponent(ValidatePackageName(PackageName))}`
  return URLInstance
}

export function BuildNpmRegistryRequestOptions(URLInstance: URL): RequestOptionsType {
  if (URLInstance.protocol !== 'https:') {
    return {}
  }

  return {
    TLS: NpmRegistryTLSOptions
  }
}

export function ValidateNpmTarballURL(TarballURL: string): URL {
  const URLInstance = new URL(TarballURL)
  const RegistryURL = GetNpmRegistryURL()

  if (URLInstance.origin !== RegistryURL.origin) {
    throw new Error(`Unexpected npm tarball origin: ${URLInstance.origin}`)
  }

  if (!URLInstance.pathname.endsWith('.tgz')) {
    throw new Error(`Unexpected npm tarball path: ${URLInstance.pathname}`)
  }

  return URLInstance
}

export async function RequestNpmPackageMetaData(PackageName: string): Promise<INpmPackageMetaData> {
  const URLInstance = BuildNpmPackageMetadataURL(PackageName)
  return RequestJSON<INpmPackageMetaData>(URLInstance, BuildNpmRegistryRequestOptions(URLInstance))
}
