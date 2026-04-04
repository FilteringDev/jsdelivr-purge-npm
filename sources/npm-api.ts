import * as Zod from 'zod'
import { RequestJSON } from './http.js'

const NpmPackageVersionMetaSchema = Zod.strictObject({
  name: Zod.string(),
  version: Zod.string(),
  dist: Zod.strictObject({
    shasum: Zod.string(),
    tarball: Zod.string(),
    integrity: Zod.string()
  })
})

const NpmPackageMetaDataSchema = Zod.strictObject({
  name: Zod.string(),
  'dist-tags': Zod.record(Zod.string(), Zod.string()),
  versions: Zod.record(Zod.string(), NpmPackageVersionMetaSchema),
  time: Zod.record(Zod.string(), Zod.string())
})

export type INpmPackageMetaData = Zod.infer<typeof NpmPackageMetaDataSchema>
export type TNpmTag = string
export type TNpmPackageVersionMeta = Zod.infer<typeof NpmPackageVersionMetaSchema>

export type INpmAPIOptions = {
  RegistryBaseURL?: string
}

function EnsureTrailingSlash(Value: string): string {
  return Value.endsWith('/') ? Value : Value + '/'
}

function EncodePackageNameForRegistry(PackageName: string): string {
  return PackageName.replaceAll('/', '%2F')
}

function CreateRegistryURL(PackageName: string, RegistryBaseURL = 'https://registry.npmjs.org/'): URL {
  return new URL(
    EnsureTrailingSlash(RegistryBaseURL) + EncodePackageNameForRegistry(PackageName)
  )
}

export async function RequestNpmPackageMetaData(
  PackageName: string,
  Options: INpmAPIOptions = {}
): Promise<INpmPackageMetaData> {
  return RequestJSON(
    CreateRegistryURL(PackageName, Options.RegistryBaseURL),
    NpmPackageMetaDataSchema
  )
}
