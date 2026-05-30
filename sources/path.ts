import * as Path from 'node:path'

export function ResolveInside(RootPath: string, ...PathParts: string[]): string {
	const ResolvedRootPath = Path.resolve(RootPath)
	const TargetPath = Path.resolve(ResolvedRootPath, ...PathParts)
	const RelativePath = Path.relative(ResolvedRootPath, TargetPath)

	if (RelativePath === '' || (!RelativePath.startsWith('..') && !Path.isAbsolute(RelativePath))) {
		return TargetPath
	}

	throw new Error(`Path escapes safe root: ${TargetPath}`)
}

export function AssertRelativePackagePath(FilePath: string): string {
	const NormalizedPath = Path.posix.normalize(FilePath.replaceAll('\\', '/'))

	if (NormalizedPath.startsWith('../') || NormalizedPath === '..' || Path.posix.isAbsolute(NormalizedPath)) {
		throw new Error(`Unsafe archive path: ${FilePath}`)
	}

	if (!NormalizedPath.startsWith('package/')) {
		throw new Error(`Archive path is outside package/: ${FilePath}`)
	}

	return NormalizedPath
}

export function ToPosixRelativePath(BasePath: string, TargetPath: string): string {
	const RelativePath = Path.relative(BasePath, TargetPath)

	if (RelativePath.startsWith('..') || Path.isAbsolute(RelativePath)) {
		throw new Error(`Path escapes safe root: ${TargetPath}`)
	}

	return RelativePath.split(Path.sep).join('/')
}
