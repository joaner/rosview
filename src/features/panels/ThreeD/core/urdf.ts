import * as THREE from 'three';

import type {
  ParsedUrdf,
  Pose,
  Quaternion,
  TransformDefinition,
  UrdfCollider,
  UrdfGeometry,
  UrdfJoint,
  UrdfLink,
  UrdfMaterial,
  UrdfRobot,
  UrdfVisual,
  Vector3,
} from './types';
import { eulerToQuaternion } from './types';

const JOINT_TYPES = new Set([
  'fixed',
  'continuous',
  'revolute',
  'planar',
  'prismatic',
  'floating',
]);

export function parseUrdf(text: string): ParsedUrdf {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'text/xml');
  const robotNode = xml.querySelector('robot');
  if (!robotNode) {
    throw new Error('No <robot> found in URDF');
  }

  const robot = parseRobot(robotNode);
  const frames = Array.from(robot.links.values(), (link) => link.name);
  const transforms = Array.from(robot.joints.values(), (joint): TransformDefinition => ({
    parent: joint.parent,
    child: joint.child,
    translation: joint.origin.xyz,
    rotation: eulerToQuaternion(joint.origin.rpy),
    joint,
  }));

  return { robot, frames, transforms };
}

function parseRobot(xml: Element): UrdfRobot {
  const name = xml.getAttribute('name');
  if (!name) {
    throw new Error('<robot> name is missing');
  }

  const links = new Map<string, UrdfLink>();
  const joints = new Map<string, UrdfJoint>();
  const materials = new Map<string, UrdfMaterial>();

  for (const child of Array.from(xml.children)) {
    const childName = child.getAttribute('name');
    if (!childName) {
      continue;
    }
    switch (child.nodeName) {
      case 'link':
        links.set(childName, parseLink(child));
        break;
      case 'joint':
        joints.set(childName, parseJoint(child));
        break;
      case 'material':
        materials.set(childName, parseMaterial(child));
        break;
      default:
        break;
    }
  }

  return { name, links, joints, materials };
}

function parseLink(xml: Element): UrdfLink {
  const name = xml.getAttribute('name');
  if (!name) {
    throw new Error('URDF link is missing name');
  }

  const link: UrdfLink = { name, visuals: [], colliders: [] };
  for (const child of Array.from(xml.children)) {
    switch (child.nodeName) {
      case 'visual':
        link.visuals.push(parseVisual(child));
        break;
      case 'collision':
        link.colliders.push(parseCollision(child));
        break;
      default:
        break;
    }
  }
  return link;
}

function parseJoint(xml: Element): UrdfJoint {
  const name = xml.getAttribute('name');
  const jointType = xml.getAttribute('type');
  if (!name) {
    throw new Error('URDF joint is missing name');
  }
  if (!jointType || !JOINT_TYPES.has(jointType)) {
    throw new Error(`Invalid joint type "${jointType}" for joint "${name}"`);
  }

  let origin: Pose | undefined;
  let parent: string | undefined;
  let child: string | undefined;
  let axis: Vector3 | undefined;
  let limit: UrdfJoint['limit'];

  for (const node of Array.from(xml.children)) {
    switch (node.nodeName) {
      case 'origin':
        origin = parsePose(node);
        break;
      case 'parent':
        parent = node.getAttribute('link') ?? undefined;
        break;
      case 'child':
        child = node.getAttribute('link') ?? undefined;
        break;
      case 'axis':
        axis = parseVec3Attribute(node, 'xyz') ?? undefined;
        break;
      case 'limit':
        limit = {
          lower: parseFloatAttributeOptional(node, 'lower') ?? 0,
          upper: parseFloatAttributeOptional(node, 'upper') ?? 0,
          effort: parseFloatAttributeOptional(node, 'effort') ?? 0,
          velocity: parseFloatAttributeOptional(node, 'velocity') ?? 0,
        };
        break;
      default:
        break;
    }
  }

  if (!parent || !child) {
    throw new Error(`Joint "${name}" is missing parent or child`);
  }

  return {
    name,
    jointType: jointType as UrdfJoint['jointType'],
    origin: origin ?? defaultPose(),
    parent,
    child,
    axis: axis ?? { x: 1, y: 0, z: 0 },
    limit,
  };
}

function parseVisual(xml: Element): UrdfVisual {
  const geometry = parseGeometryContainer(xml, 'visual');
  return {
    name: xml.getAttribute('name') ?? undefined,
    origin: parseSinglePose(xml) ?? defaultPose(),
    geometry,
    material: parseSingleMaterial(xml),
  };
}

function parseCollision(xml: Element): UrdfCollider {
  return {
    name: xml.getAttribute('name') ?? undefined,
    origin: parseSinglePose(xml) ?? defaultPose(),
    geometry: parseGeometryContainer(xml, 'collision'),
  };
}

function parseSinglePose(xml: Element): Pose | undefined {
  const node = Array.from(xml.children).find((child) => child.nodeName === 'origin');
  return node ? parsePose(node) : undefined;
}

function parseSingleMaterial(xml: Element): UrdfMaterial | undefined {
  const node = Array.from(xml.children).find((child) => child.nodeName === 'material');
  return node ? parseMaterial(node) : undefined;
}

function parseGeometryContainer(xml: Element, tagName: string): UrdfGeometry {
  const geometryNode = Array.from(xml.children).find((child) => child.nodeName === 'geometry');
  if (!geometryNode || geometryNode.children.length === 0) {
    throw new Error(`<${tagName}> must contain a <geometry> child`);
  }
  return parseGeometry(geometryNode);
}

function parseGeometry(xml: Element): UrdfGeometry {
  const child = xml.children[0];
  if (!child) {
    throw new Error('<geometry> must contain a geometry element');
  }

  switch (child.nodeName) {
    case 'box': {
      const size = parseVec3Attribute(child, 'size');
      if (!size) {
        throw new Error('<box> is missing size');
      }
      return { geometryType: 'box', size };
    }
    case 'cylinder': {
      const radius = parseFloatAttribute(child, 'radius');
      const length = parseFloatAttribute(child, 'length');
      return { geometryType: 'cylinder', radius, length };
    }
    case 'sphere': {
      const radius = parseFloatAttribute(child, 'radius');
      return { geometryType: 'sphere', radius };
    }
    case 'mesh': {
      const filename = child.getAttribute('filename');
      if (!filename) {
        throw new Error('<mesh> is missing filename');
      }
      const scale = parseVec3Attribute(child, 'scale') ?? undefined;
      return { geometryType: 'mesh', filename, scale };
    }
    default:
      throw new Error(`Unsupported geometry type "${child.nodeName}"`);
  }
}

function parseMaterial(xml: Element): UrdfMaterial {
  const material: UrdfMaterial = {
    name: xml.getAttribute('name') ?? undefined,
  };

  for (const child of Array.from(xml.children)) {
    switch (child.nodeName) {
      case 'color':
        material.color = parseColorAttribute(child, 'rgba') ?? undefined;
        break;
      case 'texture':
        material.texture = child.getAttribute('filename') ?? undefined;
        break;
      default:
        break;
    }
  }

  return material;
}

function parsePose(xml: Element): Pose {
  return {
    xyz: parseVec3Attribute(xml, 'xyz') ?? { x: 0, y: 0, z: 0 },
    rpy: parseVec3Attribute(xml, 'rpy') ?? { x: 0, y: 0, z: 0 },
  };
}

function parseColorAttribute(
  xml: Element,
  attribute: string,
): { r: number; g: number; b: number; a: number } | undefined {
  const text = xml.getAttribute(attribute);
  if (!text) {
    return undefined;
  }
  const parts = text
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
    return undefined;
  }
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] };
}

function parseVec3Attribute(xml: Element, attribute: string): Vector3 | undefined {
  const text = xml.getAttribute(attribute);
  if (!text) {
    return undefined;
  }
  const parts = text
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  if (parts.length !== 3 || parts.some((value) => Number.isNaN(value))) {
    return undefined;
  }
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function parseFloatAttribute(xml: Element, attribute: string): number {
  const value = parseFloatAttributeOptional(xml, attribute);
  if (value == undefined) {
    throw new Error(`Missing attribute "${attribute}" on <${xml.nodeName}>`);
  }
  return value;
}

function parseFloatAttributeOptional(xml: Element, attribute: string): number | undefined {
  const text = xml.getAttribute(attribute);
  if (!text) {
    return undefined;
  }
  const value = Number.parseFloat(text);
  return Number.isNaN(value) ? undefined : value;
}

function defaultPose(): Pose {
  return {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { x: 0, y: 0, z: 0 },
  };
}

export function composeJointTransform(
  joint: UrdfJoint,
  value: number,
): { translation: Vector3; rotation: Quaternion } {
  const originPosition = new THREE.Vector3(joint.origin.xyz.x, joint.origin.xyz.y, joint.origin.xyz.z);
  const originRotation = new THREE.Quaternion();
  const originQuat = eulerToQuaternion(joint.origin.rpy);
  originRotation.set(originQuat.x, originQuat.y, originQuat.z, originQuat.w);

  const jointMatrix = new THREE.Matrix4().compose(
    originPosition,
    originRotation,
    new THREE.Vector3(1, 1, 1),
  );

  const motionMatrix = new THREE.Matrix4().identity();
  const axis = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z);
  if (axis.lengthSq() > 0) {
    axis.normalize();
  }

  if (joint.jointType === 'revolute' || joint.jointType === 'continuous') {
    const motionQuaternion = new THREE.Quaternion().setFromAxisAngle(axis, value);
    motionMatrix.makeRotationFromQuaternion(motionQuaternion);
  } else if (joint.jointType === 'prismatic') {
    motionMatrix.makeTranslation(axis.x * value, axis.y * value, axis.z * value);
  }

  jointMatrix.multiply(motionMatrix);

  const translation = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  jointMatrix.decompose(translation, rotation, scale);

  return {
    translation: { x: translation.x, y: translation.y, z: translation.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  };
}
