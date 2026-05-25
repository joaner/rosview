/** teleop_tf `rotate_mesh`: post-multiply visual origin by R(-π/2, 0, 0). */
export const TELEOP_ROTATE_MESH_RPY: [number, number, number] = [-Math.PI / 2, 0, 0];

export type UrdfVisualCorrectionOptions = {
  rotateMeshVisuals: boolean;
  visualRpyOffset: [number, number, number];
};

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

/** URDF / scipy extrinsic xyz: R = Rz(yaw) * Ry(pitch) * Rx(roll). */
export function rotationMatrixFromRpy(roll: number, pitch: number, yaw: number): Mat3 {
  const cx = Math.cos(roll);
  const sx = Math.sin(roll);
  const cy = Math.cos(pitch);
  const sy = Math.sin(pitch);
  const cz = Math.cos(yaw);
  const sz = Math.sin(yaw);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

export function rpyFromRotationMatrix(m: Mat3): [number, number, number] {
  const sy = -m[2][0];
  if (Math.abs(sy) < 1 - 1e-6) {
    const pitch = Math.asin(sy);
    const roll = Math.atan2(m[2][1], m[2][2]);
    const yaw = Math.atan2(m[1][0], m[0][0]);
    return [roll, pitch, yaw];
  }
  const pitch = sy > 0 ? Math.PI / 2 : -Math.PI / 2;
  const roll = Math.atan2(-m[0][1], m[1][1]);
  return [roll, pitch, 0];
}

export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out as Mat3;
}

/** Match teleop_tf `update_rpy_in_xml`: origin' = origin @ R(-π/2, 0, 0), then optional offset. */
export function transformVisualOriginRpy(
  rpy: [number, number, number],
  options: UrdfVisualCorrectionOptions,
): [number, number, number] {
  let matrix = rotationMatrixFromRpy(rpy[0], rpy[1], rpy[2]);
  if (options.rotateMeshVisuals) {
    const fix = rotationMatrixFromRpy(...TELEOP_ROTATE_MESH_RPY);
    matrix = multiplyMat3(matrix, fix);
  }
  if (!options.visualRpyOffset.every((value) => value === 0)) {
    const offset = rotationMatrixFromRpy(
      options.visualRpyOffset[0],
      options.visualRpyOffset[1],
      options.visualRpyOffset[2],
    );
    matrix = multiplyMat3(matrix, offset);
  }
  return rpyFromRotationMatrix(matrix);
}

export function applyUrdfVisualCorrection(
  urdfText: string,
  options: UrdfVisualCorrectionOptions,
): string {
  if (!options.rotateMeshVisuals && options.visualRpyOffset.every((value) => value === 0)) {
    return urdfText;
  }

  let result = urdfText.replace(
    /(<visual\b[\s\S]*?<origin\b[^>]*\brpy=")([^"]*)(")/g,
    (_match, prefix: string, rpyRaw: string, suffix: string) => {
      const parts = rpyRaw.split(/\s+/).map(Number);
      const roll = Number.isFinite(parts[0]) ? parts[0] : 0;
      const pitch = Number.isFinite(parts[1]) ? parts[1] : 0;
      const yaw = Number.isFinite(parts[2]) ? parts[2] : 0;
      const next = transformVisualOriginRpy([roll, pitch, yaw], options);
      return `${prefix}${next[0]} ${next[1]} ${next[2]}${suffix}`;
    },
  );

  // URDF default origin is identity; inject <origin> when missing (e.g. DA_TRON2A).
  result = result.replace(/<visual\b[^>]*>([\s\S]*?)<\/visual>/g, (full, inner: string) => {
    if (/<origin\b/i.test(inner)) {
      return full;
    }
    const rpy = transformVisualOriginRpy([0, 0, 0], options);
    const originTag = `<origin xyz="0 0 0" rpy="${rpy[0]} ${rpy[1]} ${rpy[2]}"/>`;
    return full.replace(/(<visual\b[^>]*>)/, `$1\n      ${originTag}`);
  });

  // Origins with xyz but no rpy attribute.
  result = result.replace(
    /(<visual\b[\s\S]*?<origin\b(?![^>]*\brpy=)[^>]*)(>)/g,
    (_match, prefix: string, suffix: string) => {
      const rpy = transformVisualOriginRpy([0, 0, 0], options);
      return `${prefix} rpy="${rpy[0]} ${rpy[1]} ${rpy[2]}"${suffix}`;
    },
  );

  return result;
}

/** Embedded into exported MCAP scripts (keep in sync with applyUrdfVisualCorrection). */
export const URDF_VISUAL_CORRECTION_JS = `
const TELEOP_ROTATE_MESH_RPY = [-Math.PI / 2, 0, 0];

function rotationMatrixFromRpy(roll, pitch, yaw) {
  const cx = Math.cos(roll), sx = Math.sin(roll);
  const cy = Math.cos(pitch), sy = Math.sin(pitch);
  const cz = Math.cos(yaw), sz = Math.sin(yaw);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

function rpyFromRotationMatrix(m) {
  const sy = -m[2][0];
  if (Math.abs(sy) < 1 - 1e-6) {
    const pitch = Math.asin(sy);
    const roll = Math.atan2(m[2][1], m[2][2]);
    const yaw = Math.atan2(m[1][0], m[0][0]);
    return [roll, pitch, yaw];
  }
  const pitch = sy > 0 ? Math.PI / 2 : -Math.PI / 2;
  const roll = Math.atan2(-m[0][1], m[1][1]);
  return [roll, pitch, 0];
}

function multiplyMat3(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function transformVisualOriginRpy(rpy, options) {
  let matrix = rotationMatrixFromRpy(rpy[0], rpy[1], rpy[2]);
  if (options.rotateMeshVisuals) {
    matrix = multiplyMat3(matrix, rotationMatrixFromRpy(...TELEOP_ROTATE_MESH_RPY));
  }
  const offset = options.visualRpyOffset ?? [0, 0, 0];
  if (!offset.every((value) => value === 0)) {
    matrix = multiplyMat3(matrix, rotationMatrixFromRpy(offset[0], offset[1], offset[2]));
  }
  return rpyFromRotationMatrix(matrix);
}

function prepareUrdfXml(xml, recipe) {
  const urdf = recipe.urdf ?? {};
  const options = {
    rotateMeshVisuals: !!urdf.rotateMeshVisuals,
    visualRpyOffset: Array.isArray(urdf.visualRpyOffset) ? urdf.visualRpyOffset : [0, 0, 0],
  };
  if (!options.rotateMeshVisuals && options.visualRpyOffset.every((value) => value === 0)) {
    return xml;
  }
  let result = xml.replace(
    /(<visual\\b[\\s\\S]*?<origin\\b[^>]*\\brpy=")([^"]*)(")/g,
    (_match, prefix, rpyRaw, suffix) => {
      const parts = rpyRaw.split(/\\s+/).map(Number);
      const roll = Number.isFinite(parts[0]) ? parts[0] : 0;
      const pitch = Number.isFinite(parts[1]) ? parts[1] : 0;
      const yaw = Number.isFinite(parts[2]) ? parts[2] : 0;
      const next = transformVisualOriginRpy([roll, pitch, yaw], options);
      return \`\${prefix}\${next[0]} \${next[1]} \${next[2]}\${suffix}\`;
    },
  );
  result = result.replace(/<visual\\b[^>]*>([\\s\\S]*?)<\\/visual>/g, (full, inner) => {
    if (/<origin\\b/i.test(inner)) {
      return full;
    }
    const rpy = transformVisualOriginRpy([0, 0, 0], options);
    const originTag = \`<origin xyz="0 0 0" rpy="\${rpy[0]} \${rpy[1]} \${rpy[2]}"/>\`;
    return full.replace(/(<visual\\b[^>]*>)/, \`$1\\n      \${originTag}\`);
  });
  result = result.replace(
    /(<visual\\b[\\s\\S]*?<origin\\b(?![^>]*\\brpy=)[^>]*)(>)/g,
    (_match, prefix, suffix) => {
      const rpy = transformVisualOriginRpy([0, 0, 0], options);
      return \`\${prefix} rpy="\${rpy[0]} \${rpy[1]} \${rpy[2]}"\${suffix}\`;
    },
  );
  return result;
}
`.trim();

/** Embedded into exported Python MCAP scripts (keep in sync with applyUrdfVisualCorrection). */
export const URDF_VISUAL_CORRECTION_PY = `
import math
import re

TELEOP_ROTATE_MESH_RPY = [-math.pi / 2, 0.0, 0.0]

def rotation_matrix_from_rpy(roll, pitch, yaw):
    cx, sx = math.cos(roll), math.sin(roll)
    cy, sy = math.cos(pitch), math.sin(pitch)
    cz, sz = math.cos(yaw), math.sin(yaw)
    return [
        [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
        [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
        [-sy, cy * sx, cy * cx],
    ]

def rpy_from_rotation_matrix(m):
    sy = -m[2][0]
    if abs(sy) < 1 - 1e-6:
        pitch = math.asin(sy)
        roll = math.atan2(m[2][1], m[2][2])
        yaw = math.atan2(m[1][0], m[0][0])
        return [roll, pitch, yaw]
    pitch = math.pi / 2 if sy > 0 else -math.pi / 2
    roll = math.atan2(-m[0][1], m[1][1])
    return [roll, pitch, 0.0]

def multiply_mat3(a, b):
    out = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
    for i in range(3):
        for j in range(3):
            out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]
    return out

def transform_visual_origin_rpy(rpy, options):
    matrix = rotation_matrix_from_rpy(rpy[0], rpy[1], rpy[2])
    if options['rotateMeshVisuals']:
        matrix = multiply_mat3(matrix, rotation_matrix_from_rpy(*TELEOP_ROTATE_MESH_RPY))
    offset = options.get('visualRpyOffset') or [0, 0, 0]
    if not all(v == 0 for v in offset):
        matrix = multiply_mat3(matrix, rotation_matrix_from_rpy(offset[0], offset[1], offset[2]))
    return rpy_from_rotation_matrix(matrix)

def prepare_urdf_xml(xml, recipe):
    urdf = recipe.get('urdf') or {}
    options = {
        'rotateMeshVisuals': bool(urdf.get('rotateMeshVisuals')),
        'visualRpyOffset': urdf.get('visualRpyOffset') or [0, 0, 0],
    }
    if not options['rotateMeshVisuals'] and all(v == 0 for v in options['visualRpyOffset']):
        return xml

    def repl_rpy(match):
        prefix, rpy_raw, suffix = match.group(1), match.group(2) or '0 0 0', match.group(3)
        parts = [float(v or 0) for v in rpy_raw.split()]
        while len(parts) < 3:
            parts.append(0.0)
        next_rpy = transform_visual_origin_rpy(parts[:3], options)
        return f'{prefix}{next_rpy[0]} {next_rpy[1]} {next_rpy[2]}{suffix}'

    result = re.sub(
        r'(<visual\\b[\\s\\S]*?<origin\\b[^>]*\\brpy=")([^"]*)(")',
        repl_rpy,
        xml,
    )

    def repl_missing_origin(match):
        full, inner = match.group(0), match.group(1)
        if re.search(r'<origin\\b', inner, re.I):
            return full
        rpy = transform_visual_origin_rpy([0.0, 0.0, 0.0], options)
        origin_tag = f'<origin xyz="0 0 0" rpy="{rpy[0]} {rpy[1]} {rpy[2]}"/>'
        return re.sub(r'(<visual\\b[^>]*>)', r'\\1\\n      ' + origin_tag, full, count=1)

    result = re.sub(r'<visual\\b[^>]*>([\\s\\S]*?)</visual>', repl_missing_origin, result)

    def repl_missing_rpy(match):
        prefix, suffix = match.group(1), match.group(2)
        rpy = transform_visual_origin_rpy([0.0, 0.0, 0.0], options)
        return f'{prefix} rpy="{rpy[0]} {rpy[1]} {rpy[2]}"{suffix}'

    result = re.sub(
        r'(<visual\\b[\\s\\S]*?<origin\\b(?![^>]*\\brpy=)[^>]*)(>)',
        repl_missing_rpy,
        result,
    )
    return result
`.trim();
