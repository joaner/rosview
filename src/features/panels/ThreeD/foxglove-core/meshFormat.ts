export const SUPPORTED_MESH_EXTENSIONS = ['stl', 'dae', 'obj'] as const;
export type SupportedMeshExtension = (typeof SUPPORTED_MESH_EXTENSIONS)[number];

export function isSupportedMeshExtension(ext: string | undefined): ext is SupportedMeshExtension {
  return ext === 'stl' || ext === 'dae' || ext === 'obj';
}

/**
 * Extract a supported mesh extension from a path or URL basename.
 * Returns undefined when the suffix is missing or not stl/dae/obj (never returns the whole URL).
 */
export function getMeshExtensionFromPath(path: string): SupportedMeshExtension | undefined {
  const withoutQuery = path.split('?')[0] ?? path;
  const basename = withoutQuery.split('/').pop() ?? withoutQuery;
  if (!basename.includes('.')) {
    return undefined;
  }
  const ext = basename.split('.').pop()?.toLowerCase();
  return isSupportedMeshExtension(ext) ? ext : undefined;
}

/** @deprecated Prefer {@link getMeshExtensionFromPath} or {@link resolveMeshFormat}. */
export function getMeshExtensionFromUrl(meshUrl: string): SupportedMeshExtension | undefined {
  return getMeshExtensionFromPath(meshUrl);
}

/**
 * Resolve mesh format for loading.
 * URDF `sourcePath` is authoritative — blob URLs from `URL.createObjectURL` carry no file suffix.
 * `resolvedUrl` is used as a fallback for remote assets whose URL includes an extension.
 */
export function resolveMeshFormat(
  sourcePath: string,
  resolvedUrl: string,
): SupportedMeshExtension | undefined {
  return getMeshExtensionFromPath(sourcePath) ?? getMeshExtensionFromPath(resolvedUrl);
}
