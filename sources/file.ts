import { Piscina } from 'piscina'
import * as Tar from 'tar'
import * as ESToolkit from 'es-toolkit'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RequestArrayBuffer } from './http.js'
import { BuildNpmRegistryRequestOptions, RequestNpmPackageMetaData, ValidateNpmTarballURL, ValidatePackageName } from './npm-api.js'
import { AssertRelativePackagePath, ResolveInside, ToPosixRelativePath } from './path.js'

export type FileDownloadWorkerDataType = {
  Repo: string
  Version: string
  WorkPath: string
}

const CurrentFilename = fileURLToPath(import.meta.url)
const CurrentDirname = Path.dirname(CurrentFilename)
const FileWorkerFilename = Path.join(CurrentDirname, 'file-worker.ts')
const VersionRegExp = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u

export class FileManager {
  private readonly NpmRepo: string
  private readonly Repo: string
  private readonly Versions: { A: string, B?: string }
  private readonly WorkPath: string

  constructor(Repo: string, Versions: { A: string, B?: string }, WorkPath?: string) {
    this.NpmRepo = ValidatePackageName(Repo)
    this.Repo = this.NpmRepo.split('/').at(-1) ?? this.NpmRepo
    this.Versions = Versions
    this.WorkPath = WorkPath ?? Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jsdelivr-purge-npm-files-'))
  }

  private async DownloadRepoVersion() {
    const PiscinaInstance = new Piscina({
      filename: FileWorkerFilename,
      maxThreads: Os.cpus().length
    })
    const Versions = [this.Versions.A, this.Versions.B].filter((Item): Item is string => typeof Item !== 'undefined')

    await Promise.all(Versions.map(Version => PiscinaInstance.run({
      Repo: this.NpmRepo,
      Version,
      WorkPath: this.WorkPath
    } satisfies FileDownloadWorkerDataType)))
    await PiscinaInstance.destroy()
  }

  private UnionRepoFiles() {
    const RepoAFiles = ListPackageFiles(GetVersionPath(this.WorkPath, this.Repo, this.Versions.A))
    if (typeof this.Versions.B !== 'undefined') {
      const RepoBFiles = ListPackageFiles(GetVersionPath(this.WorkPath, this.Repo, this.Versions.B))
      return ESToolkit.union(RepoAFiles, RepoBFiles)
    }
    return RepoAFiles
  }

  async Union() {
    await this.DownloadRepoVersion()
    return this.UnionRepoFiles()
  }
}

export async function DownloadRepoVersionTask(TaskData: FileDownloadWorkerDataType): Promise<void> {
  const PackageMetadata = await RequestNpmPackageMetaData(TaskData.Repo)
  const Version = ValidateVersion(TaskData.Version)
  const VersionMetadata = PackageMetadata.versions[Version]

  if (typeof VersionMetadata === 'undefined') {
    throw new Error(`Unknown npm package version: ${Version}`)
  }

  const TarballURL = ValidateNpmTarballURL(VersionMetadata.dist.tarball)
  const TarFile = await RequestArrayBuffer(TarballURL, BuildNpmRegistryRequestOptions(TarballURL))
  const RepoName = ValidatePackageName(TaskData.Repo).split('/').at(-1) ?? TaskData.Repo
  const VersionPath = GetVersionPath(TaskData.WorkPath, RepoName, Version)

  Fs.mkdirSync(VersionPath, { recursive: true, mode: 0o700 })
  const TarballPath = ResolveInside(VersionPath, Version + '.tgz')
  Fs.writeFileSync(TarballPath, Buffer.from(TarFile), { mode: 0o600 })
  await Tar.extract({
    file: TarballPath,
    cwd: VersionPath,
    filter: (ArchivePath, Entry) => {
      AssertRelativePackagePath(ArchivePath)
      const EntryType = Reflect.get(Entry, 'type')
      return EntryType === 'File' || EntryType === 'Directory'
    }
  })
  Fs.rmSync(TarballPath)
}

function ValidateVersion(Version: string): string {
  if (!VersionRegExp.test(Version)) {
    throw new Error(`Invalid package version: ${Version}`)
  }

  return Version
}

function GetVersionPath(WorkPath: string, Repo: string, Version: string): string {
  return ResolveInside(WorkPath, `${Repo}-${ValidateVersion(Version)}`)
}

function ListPackageFiles(VersionPath: string): string[] {
  const PackagePath = ResolveInside(VersionPath, 'package')
  return ListAllFiles(PackagePath).map(Item => ToPosixRelativePath(PackagePath, Item))
}

function ListAllFiles(SourcePath: string): string[] {
  let Files: string[] = []
  for (const Current of Fs.readdirSync(SourcePath, { withFileTypes: true })) {
    const CurrentPath = ResolveInside(SourcePath, Current.name)
    if (Current.isDirectory()) {
      Files.push(...ListAllFiles(CurrentPath))
    } else if (Current.isFile()) {
      Files.push(CurrentPath)
    }
  }
  return Files
}
