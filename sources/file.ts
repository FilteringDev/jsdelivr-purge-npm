import * as ESToolkit from 'es-toolkit'
import * as Fs from 'node:fs'
import * as FsPromises from 'node:fs/promises'
import * as Path from 'node:path'
import * as Tar from 'tar'
import { RequestBuffer } from './http.js'

export type IFileManagerOptions = {
  RegistryBaseURL?: string
}

export class FileManager {
  private readonly NpmRepo: string
  private readonly Repo: string
  private readonly Versions: { A: string, B?: string }
  private readonly WorkPath: string
  private readonly RegistryBaseURL: string

  constructor(
    Repo: string,
    Versions: { A: string, B?: string },
    WorkPath: string,
    Options: IFileManagerOptions = {}
  ) {
    this.NpmRepo = Repo
    this.Repo = Repo.includes('/') ? Repo.split('/').at(-1) ?? Repo : Repo
    this.Versions = Versions
    this.WorkPath = WorkPath
    this.RegistryBaseURL = Options.RegistryBaseURL ?? 'https://registry.npmjs.org/'
  }

  private EnsureTrailingSlash(Value: string): string {
    return Value.endsWith('/') ? Value : Value + '/'
  }

  private EncodePackageNameForRegistry(PackageName: string): string {
    return PackageName.replaceAll('/', '%2F')
  }

  private CreateTarballURL(Version: string): URL {
    return new URL(
      this.EnsureTrailingSlash(this.RegistryBaseURL) + this.EncodePackageNameForRegistry(this.NpmRepo) + '/-/' + this.Repo + '-' + Version + '.tgz'
    )
  }

  private GetTargetVersions(): string[] {
    return [...new Set([this.Versions.A, this.Versions.B].filter((Item): Item is string => typeof Item === 'string'))]
  }

  private async DownloadRepoVersion(Version: string): Promise<void> {
    const TarballBuffer = await RequestBuffer(this.CreateTarballURL(Version))
    const TarballPath = Path.join(this.WorkPath, this.Repo + '-' + Version + '.tgz')
    const ExtractPath = Path.join(this.WorkPath, this.Repo + '-' + Version)

    await FsPromises.mkdir(this.WorkPath, { recursive: true })
    await FsPromises.writeFile(TarballPath, TarballBuffer)
    await FsPromises.mkdir(ExtractPath, { recursive: true })
    await Tar.extract({ file: TarballPath, cwd: ExtractPath })
    await FsPromises.rm(TarballPath)
  }

  private ToPackageRelativePath(SourcePath: string, FilePath: string): string {
    return Path.relative(Path.join(SourcePath, 'package'), FilePath).split(Path.sep).join('/')
  }

  private UnionRepoFiles(): string[] {
    const RepoARoot = Path.join(this.WorkPath, this.Repo + '-' + this.Versions.A)
    const RepoAFiles = ListAllFiles(RepoARoot).map((Item) => this.ToPackageRelativePath(RepoARoot, Item))

    if (typeof this.Versions.B === 'undefined') {
      return RepoAFiles
    }

    const RepoBRoot = Path.join(this.WorkPath, this.Repo + '-' + this.Versions.B)
    const RepoBFiles = ListAllFiles(RepoBRoot).map((Item) => this.ToPackageRelativePath(RepoBRoot, Item))

    return ESToolkit.union(RepoAFiles, RepoBFiles)
  }

  async Union(): Promise<string[]> {
    await Promise.all(this.GetTargetVersions().map((Version) => this.DownloadRepoVersion(Version)))
    return this.UnionRepoFiles()
  }
}

function ListAllFiles(SourcePath: string): string[] {
  const Files: string[] = []

  for (const Current of Fs.readdirSync(SourcePath)) {
    const CurrentPath = Path.join(SourcePath, Current)

    if (Fs.statSync(CurrentPath).isDirectory()) {
      Files.push(...ListAllFiles(CurrentPath))
      continue
    }

    Files.push(CurrentPath)
  }

  return Files
}
