import * as Zlib from 'node:zlib'

const LocalFileHeaderSignature = 0x04034b50
const CentralDirectoryHeaderSignature = 0x02014b50
const EndOfCentralDirectorySignature = 0x06054b50

type IZipCentralDirectoryEntry = {
  Name: string
  CompressionMethod: number
  CompressedSize: number
  UncompressedSize: number
  LocalHeaderOffset: number
}

function FindEndOfCentralDirectoryOffset(ArchiveBuffer: Buffer): number {
  const MinimumOffset = Math.max(0, ArchiveBuffer.length - 65557)

  for (let Offset = ArchiveBuffer.length - 22; Offset >= MinimumOffset; Offset -= 1) {
    if (ArchiveBuffer.readUInt32LE(Offset) === EndOfCentralDirectorySignature) {
      return Offset
    }
  }

  throw new Error('Invalid ZIP archive: end of central directory not found')
}

function ReadCentralDirectoryEntries(ArchiveBuffer: Buffer): IZipCentralDirectoryEntry[] {
  const EndOfCentralDirectoryOffset = FindEndOfCentralDirectoryOffset(ArchiveBuffer)
  const CentralDirectorySize = ArchiveBuffer.readUInt32LE(EndOfCentralDirectoryOffset + 12)
  const CentralDirectoryOffset = ArchiveBuffer.readUInt32LE(EndOfCentralDirectoryOffset + 16)
  const Entries: IZipCentralDirectoryEntry[] = []
  const CentralDirectoryEnd = CentralDirectoryOffset + CentralDirectorySize
  let Offset = CentralDirectoryOffset

  while (Offset < CentralDirectoryEnd) {
    if (ArchiveBuffer.readUInt32LE(Offset) !== CentralDirectoryHeaderSignature) {
      throw new Error('Invalid ZIP archive: central directory header not found')
    }

    const CompressionMethod = ArchiveBuffer.readUInt16LE(Offset + 10)
    const CompressedSize = ArchiveBuffer.readUInt32LE(Offset + 20)
    const UncompressedSize = ArchiveBuffer.readUInt32LE(Offset + 24)
    const FileNameLength = ArchiveBuffer.readUInt16LE(Offset + 28)
    const ExtraFieldLength = ArchiveBuffer.readUInt16LE(Offset + 30)
    const FileCommentLength = ArchiveBuffer.readUInt16LE(Offset + 32)
    const LocalHeaderOffset = ArchiveBuffer.readUInt32LE(Offset + 42)
    const FileNameStart = Offset + 46
    const FileNameEnd = FileNameStart + FileNameLength
    const Name = ArchiveBuffer.toString('utf8', FileNameStart, FileNameEnd)

    Entries.push({
      Name,
      CompressionMethod,
      CompressedSize,
      UncompressedSize,
      LocalHeaderOffset
    })

    Offset = FileNameEnd + ExtraFieldLength + FileCommentLength
  }

  return Entries
}

function ExtractCentralDirectoryEntry(
  ArchiveBuffer: Buffer,
  Entry: IZipCentralDirectoryEntry
): Buffer {
  if (ArchiveBuffer.readUInt32LE(Entry.LocalHeaderOffset) !== LocalFileHeaderSignature) {
    throw new Error('Invalid ZIP archive: local file header missing for ' + Entry.Name)
  }

  const FileNameLength = ArchiveBuffer.readUInt16LE(Entry.LocalHeaderOffset + 26)
  const ExtraFieldLength = ArchiveBuffer.readUInt16LE(Entry.LocalHeaderOffset + 28)
  const DataOffset = Entry.LocalHeaderOffset + 30 + FileNameLength + ExtraFieldLength
  const CompressedBuffer = ArchiveBuffer.subarray(DataOffset, DataOffset + Entry.CompressedSize)

  if (Entry.CompressionMethod === 0) {
    return Buffer.from(CompressedBuffer)
  }

  if (Entry.CompressionMethod === 8) {
    const DecompressedBuffer = Zlib.inflateRawSync(CompressedBuffer)

    if (Entry.UncompressedSize !== 0 && DecompressedBuffer.length !== Entry.UncompressedSize) {
      throw new Error('Invalid ZIP archive: unexpected size for ' + Entry.Name)
    }

    return DecompressedBuffer
  }

  throw new Error('Unsupported ZIP compression method: ' + Entry.CompressionMethod)
}

export function ReadTextFromZipArchive(
  ArchiveBuffer: Buffer,
  Predicate: (EntryName: string) => boolean
): string {
  const Entry = ReadCentralDirectoryEntries(ArchiveBuffer).find((Item) => Predicate(Item.Name))

  if (typeof Entry === 'undefined') {
    throw new Error('ZIP entry not found')
  }

  return ExtractCentralDirectoryEntry(ArchiveBuffer, Entry).toString('utf8')
}
