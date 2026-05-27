import type { Time } from '@/core/types/ros';

export type Vector3 = { x: number; y: number; z: number };
export type Quaternion = { x: number; y: number; z: number; w: number };
export type Pose = { xyz: Vector3; rpy: Vector3 };

export function eulerToQuaternion(rpy: Vector3): Quaternion {
  const roll = rpy.x;
  const pitch = rpy.y;
  const yaw = rpy.z;

  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);

  return {
    x: cy * sr * cp - sy * cr * sp,
    y: cy * cr * sp + sy * sr * cp,
    z: sy * cr * cp - cy * sr * sp,
    w: cy * cr * cp + sy * sr * sp,
  };
}

export interface TFTransform {
  header: { stamp: Time; frame_id: string };
  child_frame_id: string;
  transform: {
    translation: Vector3;
    rotation: Quaternion;
  };
}

export interface TFMessage {
  transforms: TFTransform[];
}

export type JointType = "fixed" | "continuous" | "revolute" | "planar" | "prismatic" | "floating";

export type UrdfGeometryBox = {
  geometryType: "box";
  size: Vector3;
};

export type UrdfGeometryCylinder = {
  geometryType: "cylinder";
  radius: number;
  length: number;
};

export type UrdfGeometrySphere = {
  geometryType: "sphere";
  radius: number;
};

export type UrdfGeometryMesh = {
  geometryType: "mesh";
  filename: string;
  scale?: Vector3;
};

export type UrdfGeometry =
  | UrdfGeometryBox
  | UrdfGeometryCylinder
  | UrdfGeometrySphere
  | UrdfGeometryMesh;

export type UrdfMaterial = {
  name?: string;
  color?: { r: number; g: number; b: number; a: number };
  texture?: string;
};

export type UrdfVisual = {
  name?: string;
  origin: Pose;
  geometry: UrdfGeometry;
  material?: UrdfMaterial;
};

export type UrdfCollider = {
  name?: string;
  origin: Pose;
  geometry: UrdfGeometry;
};

export type UrdfLink = {
  name: string;
  visuals: UrdfVisual[];
  colliders: UrdfCollider[];
};

export type UrdfJoint = {
  name: string;
  jointType: JointType;
  origin: Pose;
  parent: string;
  child: string;
  axis: Vector3;
  limit?: { lower: number; upper: number; effort: number; velocity: number };
};

export interface UrdfRobot {
  name: string;
  links: Map<string, UrdfLink>;
  joints: Map<string, UrdfJoint>;
  materials: Map<string, UrdfMaterial>;
}

export type TransformDefinition = {
  parent: string;
  child: string;
  translation: Vector3;
  rotation: Quaternion;
  joint: UrdfJoint;
};

export type ParsedUrdf = {
  robot: UrdfRobot;
  frames: string[];
  transforms: TransformDefinition[];
};

export type JointStateMsg = {
  name: string[];
  position: number[];
  velocity?: number[];
  effort?: number[];
};
