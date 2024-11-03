import got from 'got'
import PLimit from 'p-limit'
import * as Tar from 'tar'
import * as ESToolkit from 'es-toolkit'
import * as Fs from 'node:fs'
import * as Os from 'node:os'

export class FileManager {
  private NpmRepo: string = null
  private Repo: string = null
  private Versions: { A: string, B?: string } = null
  private WorkPath: string = null

  constructor(Repo: string, Versions: { A: string, B?: string }, WorkPath: string) {
    this.NpmRepo = Repo
    this.Repo = typeof Repo.split('/')[1] === 'undefined' ? Repo : Repo.split('/')[1]
    this.Versions = Versions
    this.WorkPath = WorkPath
  }

  private async DownloadRepoVersion() {
    const PLimitInstance = PLimit(Os.cpus().length)
    const PLimitJobs: Promise<void>[] = []
    for (const Version of [this.Versions.A, this.Versions.B].filter(Item => typeof Item !== 'undefined')) {
      PLimitJobs.push(PLimitInstance(async () => {
        const TarFile = await got(`https://registry.npmjs.org/${this.NpmRepo}/-/${this.Repo}-${Version}.tgz`, {
          https: {
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.2',
            ciphers: 'ECDHE-ECDSA-AES256-GCM-SHA384;ECDHE-ECDSA-CHACHA20-POLY1305'
          },
          http2: true,
          headers: {
            'user-agent': 'jsdelivr-purge-npm'
          }
        }).buffer()
        Fs.mkdirSync(this.WorkPath, { recursive: true })
        Fs.writeFileSync(`${this.WorkPath}/${this.Repo}-${Version}.tgz`, TarFile)
        Fs.mkdirSync(`${this.WorkPath}/${this.Repo}-${Version}`, { recursive: true })
        await Tar.extract({ file: `${this.WorkPath}/${this.Repo}-${Version}.tgz`, cwd: `${this.WorkPath}/${this.Repo}-${Version}` })
        Fs.rmSync(`${this.WorkPath}/${this.Repo}-${Version}.tgz`)
      }))
    }
    await Promise.all(PLimitJobs)
  }

  private UnionRepoFiles() {
    const RepoAFiles = ListAllFiles(`${this.WorkPath}/${this.Repo}-${this.Versions.A}`).map(Item => Item.replace(`${this.WorkPath}/${this.Repo}-${this.Versions.A}/package/`, ''))
    if (typeof this.Versions.B !== 'undefined') {
      const RepoBFiles = ListAllFiles(`${this.WorkPath}/${this.Repo}-${this.Versions.B}`).map(Item => Item.replace(`${this.WorkPath}/${this.Repo}-${this.Versions.B}/package/`, ''))
      return ESToolkit.union(RepoAFiles, RepoBFiles)
    }
    return RepoAFiles
  }

  async Union() {
    await this.DownloadRepoVersion()
    return this.UnionRepoFiles()
  }
}

function ListAllFiles(SourcePath: string) {
  let Files: string[] = []
  for (const Current of Fs.readdirSync(SourcePath)) {
    if (Fs.statSync(`${SourcePath}/${Current}`).isDirectory()) {
      Files.push(...ListAllFiles(`${SourcePath}/${Current}`))
    } else {
      Files.push(`${SourcePath}/${Current}`)
    }
  }
  return Files
}