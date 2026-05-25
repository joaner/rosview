import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useRosViewTheme } from '@/features/viewer/RosViewProvider';
import { scheduleFrame } from '@/shared/utils/rafScheduler';
import {
  applyFramePoses,
  applyJointStates,
  buildRobotRenderable,
  disposeRobotRenderable,
  type MeshLoadProgress,
  type MeshUpAxis,
  type RobotRenderable,
} from '../ThreeD/foxglove-core/renderables';
import type { JointStateMsg } from '../ThreeD/foxglove-core/types';
import {
  countVisibleFrameObjects,
  type UrdfPreviewBuildResult,
  type UrdfPreviewIssue,
} from './previewStatus';

const Z_UP = new THREE.Vector3(0, 0, 1);
const GIZMO_MARGIN: [number, number] = [80, 80];
const GIZMO_AXIS_COLORS: [string, string, string] = ['#ff3653', '#0adb46', '#2c8fff'];
const CANVAS_CAMERA = {
  position: [3, -3, 2] as [number, number, number],
  up: [0, 0, 1] as [number, number, number],
  fov: 45,
  near: 0.5,
  far: 5000,
};
const MAX_OVERLAY_ISSUES = 3;

type ThemeColors = {
  panelBackgroundClassName: string;
  overlayClassName: string;
  overlayErrorClassName: string;
  sceneBackground: THREE.ColorRepresentation;
  gridPrimary: string;
  gridSecondary: string;
  gizmoLabelColor: string;
  fallbackMeshColor: string;
  meshOutlineColor: string;
};

function getThemeColors(resolvedTheme: 'light' | 'dark'): ThemeColors {
  if (resolvedTheme === 'light') {
    return {
      panelBackgroundClassName: 'bg-slate-50',
      overlayClassName: 'bg-white/80 text-slate-800 border border-slate-200',
      overlayErrorClassName: 'bg-red-50/95 text-red-800 border border-red-200',
      sceneBackground: '#f8fafc',
      gridPrimary: '#cbd5e1',
      gridSecondary: '#e2e8f0',
      gizmoLabelColor: '#0f172a',
      fallbackMeshColor: '#cbd5e1',
      meshOutlineColor: '#1e293b',
    };
  }
  return {
    panelBackgroundClassName: 'bg-[#111]',
    overlayClassName: 'bg-black/50 text-white border border-white/10',
    overlayErrorClassName: 'bg-red-950/80 text-red-200 border border-red-500/40',
    sceneBackground: '#111111',
    gridPrimary: '#666',
    gridSecondary: '#444',
    gizmoLabelColor: 'white',
    fallbackMeshColor: '#cbd5e1',
    meshOutlineColor: '#94a3b8',
  };
}

const CameraSetup: React.FC = () => {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    camera.up.copy(Z_UP);
    camera.position.set(3, -3, 2);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate]);
  return null;
};

const ZUpGrid: React.FC<{ colors: ThemeColors }> = ({ colors }) => {
  const ref = useRef<THREE.GridHelper>(null);
  useEffect(() => {
    if (ref.current) ref.current.rotation.x = -Math.PI / 2;
  }, []);
  return <gridHelper ref={ref} args={[10, 10, colors.gridPrimary, colors.gridSecondary]} />;
};

interface RobotPreviewProps {
  urdf: string;
  jointState: JointStateMsg | null;
  highFrequencyPoseUpdates: boolean;
  resolveMeshUrl: (rawPath: string) => string;
  fallbackMeshColor: string;
  meshOutlineColor: string;
  meshUpAxis: MeshUpAxis;
  onMeshLoadProgressChange?: (progress: MeshLoadProgress | null) => void;
  onMeshIssue?: (meshUrl: string, reason: string) => void;
  onPreviewBuildResult?: (result: UrdfPreviewBuildResult | null) => void;
}

const RobotPreview: React.FC<RobotPreviewProps> = ({
  urdf,
  jointState,
  highFrequencyPoseUpdates,
  resolveMeshUrl,
  fallbackMeshColor,
  meshOutlineColor,
  meshUpAxis,
  onMeshLoadProgressChange,
  onMeshIssue,
  onPreviewBuildResult,
}) => {
  const [robotModel, setRobotModel] = useState<RobotRenderable | null>(null);
  const jointStateRef = useRef<JointStateMsg | null>(jointState);
  const jointDirtyRef = useRef(true);
  const applyPendingRef = useRef(false);
  const cancelApplyFrameRef = useRef<(() => void) | null>(null);
  const buildIssuesRef = useRef<UrdfPreviewIssue[]>([]);
  const meshStatsRef = useRef({ total: 0, failed: 0 });
  const { invalidate } = useThree();

  const applyRobotPose = useCallback(
    (model: RobotRenderable, updateWorldMatrix: boolean) => {
      if (jointDirtyRef.current) {
        jointDirtyRef.current = false;
        applyJointStates(model, jointStateRef.current);
      }
      applyFramePoses(model, 0n);
      if (updateWorldMatrix) {
        model.root.updateMatrixWorld(true);
      }
      invalidate();
    },
    [invalidate],
  );

  const schedulePoseApply = useCallback(() => {
    if (!robotModel || applyPendingRef.current) return;
    applyPendingRef.current = true;
    cancelApplyFrameRef.current = scheduleFrame(() => {
      applyPendingRef.current = false;
      cancelApplyFrameRef.current = null;
      applyRobotPose(robotModel, false);
    });
  }, [robotModel, applyRobotPose]);

  useLayoutEffect(() => {
    jointStateRef.current = jointState;
    if (!robotModel) return;
    jointDirtyRef.current = true;
    if (highFrequencyPoseUpdates) {
      schedulePoseApply();
      return;
    }
    cancelApplyFrameRef.current?.();
    cancelApplyFrameRef.current = null;
    applyPendingRef.current = false;
    applyRobotPose(robotModel, true);
  }, [robotModel, jointState, highFrequencyPoseUpdates, schedulePoseApply, applyRobotPose]);

  useEffect(() => {
    return () => {
      cancelApplyFrameRef.current?.();
      cancelApplyFrameRef.current = null;
      applyPendingRef.current = false;
    };
  }, [robotModel]);

  const reportBuildResult = useCallback(
    (model: RobotRenderable | null, errorMessage?: string) => {
      if (!onPreviewBuildResult) return;
      if (!model) {
        onPreviewBuildResult({
          status: 'error',
          frameObjectCount: 0,
          visibleFrameCount: 0,
          meshTotal: meshStatsRef.current.total,
          meshFailed: meshStatsRef.current.failed,
          issues: buildIssuesRef.current,
          errorMessage,
        });
        return;
      }

      const frameObjectCount = model.frameObjects.length;
      const visibleFrameCount = countVisibleFrameObjects(model);
      const { total: meshTotal, failed: meshFailed } = meshStatsRef.current;
      const issues = buildIssuesRef.current;
      const emptyByMeshes = meshTotal > 0 && frameObjectCount === 0;
      const emptyByVisibility = frameObjectCount > 0 && visibleFrameCount === 0;
      const status =
        errorMessage != null
          ? 'error'
          : emptyByMeshes || emptyByVisibility
            ? 'empty'
            : 'ready';

      onPreviewBuildResult({
        status,
        frameObjectCount,
        visibleFrameCount,
        meshTotal,
        meshFailed,
        issues,
        errorMessage,
      });
    },
    [onPreviewBuildResult],
  );

  useEffect(() => {
    let cancelled = false;
    buildIssuesRef.current = [];
    meshStatsRef.current = { total: 0, failed: 0 };
    onPreviewBuildResult?.(null);
    onMeshLoadProgressChange?.(null);
    void (async () => {
      try {
        const model = await buildRobotRenderable(urdf, {
          resolveMeshUrl,
          meshUpAxis,
          warn: (meshUrl, reason) => {
            buildIssuesRef.current.push({ url: meshUrl, reason });
            onMeshIssue?.(meshUrl, reason);
          },
          fallbackMeshColor,
          outlineColor: meshOutlineColor,
          onMeshLoadProgress: (progress) => {
            if (!cancelled && progress) {
              meshStatsRef.current = {
                total: progress.total,
                failed: progress.failed,
              };
              onMeshLoadProgressChange?.(progress);
            }
          },
        });
        if (cancelled) {
          disposeRobotRenderable(model);
          return;
        }
        applyJointStates(model, jointStateRef.current);
        applyFramePoses(model, 0n);
        setRobotModel(model);
        onMeshLoadProgressChange?.(null);
        reportBuildResult(model);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        buildIssuesRef.current.push({ url: 'urdf', reason: message });
        onMeshIssue?.('urdf', message);
        onMeshLoadProgressChange?.(null);
        setRobotModel(null);
        reportBuildResult(null, message);
      }
    })();
    return () => {
      cancelled = true;
      onMeshLoadProgressChange?.(null);
      onPreviewBuildResult?.(null);
      setRobotModel((current) => {
        disposeRobotRenderable(current);
        return null;
      });
    };
  }, [
    urdf,
    meshUpAxis,
    fallbackMeshColor,
    meshOutlineColor,
    resolveMeshUrl,
    onMeshIssue,
    onMeshLoadProgressChange,
    onPreviewBuildResult,
    reportBuildResult,
  ]);

  return robotModel ? <primitive object={robotModel.root} /> : null;
};

export interface UrdfDebugPreviewProps {
  urdfText: string;
  jointState: JointStateMsg | null;
  highFrequencyPoseUpdates?: boolean;
  resolveMeshUrl: (rawPath: string) => string;
  fallbackMeshColor: string;
  showGrid: boolean;
  showAxes: boolean;
  rotateMeshVisuals?: boolean;
  emptyHint?: string;
  onMeshLoadProgressChange?: (progress: MeshLoadProgress | null) => void;
  onMeshIssue?: (meshUrl: string, reason: string) => void;
  onPreviewBuildResult?: (result: UrdfPreviewBuildResult | null) => void;
}

export const UrdfDebugPreview: React.FC<UrdfDebugPreviewProps> = ({
  urdfText,
  jointState,
  highFrequencyPoseUpdates = false,
  resolveMeshUrl,
  fallbackMeshColor,
  showGrid,
  showAxes,
  rotateMeshVisuals = false,
  emptyHint,
  onMeshLoadProgressChange,
  onMeshIssue,
  onPreviewBuildResult,
}) => {
  const { formatMessage } = useIntl();
  const { resolvedTheme } = useRosViewTheme();
  const colors = useMemo(() => getThemeColors(resolvedTheme), [resolvedTheme]);
  const meshUpAxis: MeshUpAxis = rotateMeshVisuals ? 'z_up' : 'y_up';
  const [meshLoadProgress, setMeshLoadProgress] = useState<MeshLoadProgress | null>(null);
  const [buildResult, setBuildResult] = useState<UrdfPreviewBuildResult | null>(null);
  const isMeshLoading =
    meshLoadProgress !== null &&
    meshLoadProgress.total > 0 &&
    meshLoadProgress.loaded < meshLoadProgress.total;

  const handleMeshProgress = useCallback(
    (progress: MeshLoadProgress | null) => {
      setMeshLoadProgress(progress);
      onMeshLoadProgressChange?.(progress);
    },
    [onMeshLoadProgressChange],
  );

  const handlePreviewBuildResult = useCallback(
    (result: UrdfPreviewBuildResult | null) => {
      setBuildResult(result);
      onPreviewBuildResult?.(result);
    },
    [onPreviewBuildResult],
  );

  if (!urdfText) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic px-4 text-center">
        {emptyHint ?? formatMessage({ id: 'urdfDebug.preview.empty' })}
      </div>
    );
  }

  const overlayHasError =
    buildResult != null && (buildResult.status === 'error' || buildResult.status === 'empty');

  const overlayLabel = isMeshLoading && meshLoadProgress
    ? formatMessage(
        { id: 'urdfDebug.preview.loadingMesh' },
        { loaded: meshLoadProgress.loaded, total: meshLoadProgress.total },
      )
    : buildResult?.status === 'error'
      ? formatMessage(
          { id: 'urdfDebug.preview.error' },
          { message: buildResult.errorMessage ?? buildResult.issues[0]?.reason ?? 'Unknown error' },
        )
      : buildResult?.status === 'empty'
        ? formatMessage(
            { id: 'urdfDebug.preview.emptyModel' },
            {
              failed: buildResult.meshFailed,
              total: buildResult.meshTotal,
              visible: buildResult.visibleFrameCount,
            },
          )
        : formatMessage(
            { id: 'urdfDebug.preview.title' },
            {
              rotateMesh: formatMessage({
                id: rotateMeshVisuals ? 'urdfDebug.preview.rotateMeshOn' : 'urdfDebug.preview.rotateMeshOff',
              }),
            },
          );

  const overlayIssues =
    buildResult != null && buildResult.issues.length > 0
      ? buildResult.issues.slice(0, MAX_OVERLAY_ISSUES)
      : [];

  return (
    <div className={`relative w-full h-full ${colors.panelBackgroundClassName}`}>
      <div className="absolute top-2 left-2 z-10 max-w-[min(92%,28rem)] space-y-1 pointer-events-none">
        <div
          className={`px-2 py-1 rounded text-[10px] font-mono ${
            isMeshLoading ? 'animate-pulse' : ''
          } ${overlayHasError ? colors.overlayErrorClassName : colors.overlayClassName}`}
        >
          {overlayLabel}
        </div>
        {overlayIssues.length > 0 && (
          <div className={`px-2 py-1 rounded text-[10px] font-mono space-y-0.5 ${colors.overlayErrorClassName}`}>
            {overlayIssues.map((issue) => (
              <div key={`${issue.url}:${issue.reason}`} className="break-all">
                {issue.url === 'urdf'
                  ? issue.reason
                  : formatMessage(
                      { id: 'urdfDebug.preview.issueLine' },
                      { url: issue.url, reason: issue.reason },
                    )}
              </div>
            ))}
            {buildResult != null && buildResult.issues.length > MAX_OVERLAY_ISSUES && (
              <div className="opacity-80">
                {formatMessage(
                  { id: 'urdfDebug.preview.moreIssues' },
                  { count: buildResult.issues.length - MAX_OVERLAY_ISSUES },
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <Canvas shadows frameloop="demand" camera={CANVAS_CAMERA} gl={{ antialias: true }}>
        <color attach="background" args={[colors.sceneBackground]} />
        <CameraSetup />
        <ambientLight intensity={0.45} />
        <hemisphereLight args={['#ffffff', '#6b7280', 0.55]} />
        <directionalLight position={[6, -4, 8]} intensity={1.05} />
        {showGrid && <ZUpGrid colors={colors} />}
        {showAxes && <axesHelper args={[1]} />}
        <Suspense fallback={null}>
          <RobotPreview
            urdf={urdfText}
            jointState={jointState}
            highFrequencyPoseUpdates={highFrequencyPoseUpdates}
            resolveMeshUrl={resolveMeshUrl}
            fallbackMeshColor={fallbackMeshColor}
            meshOutlineColor={colors.meshOutlineColor}
            meshUpAxis={meshUpAxis}
            onMeshLoadProgressChange={handleMeshProgress}
            onMeshIssue={onMeshIssue}
            onPreviewBuildResult={handlePreviewBuildResult}
          />
        </Suspense>
        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={GIZMO_MARGIN}>
          <GizmoViewport axisColors={GIZMO_AXIS_COLORS} labelColor={colors.gizmoLabelColor} />
        </GizmoHelper>
      </Canvas>
    </div>
  );
};
