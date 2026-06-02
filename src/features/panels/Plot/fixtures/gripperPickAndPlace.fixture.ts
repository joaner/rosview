/** JointState sample derived from gripper pick-and-place demo recordings. */
export const GRIPPER_JOINT_STATE_SAMPLE = {
  name: ['head_joint1', 'head_joint2', 'drive_joint'],
  position: [0.12, -0.34, 0.85],
  velocity: [0.01, -0.02, 0.0],
  effort: [1.2, 0.8, 2.1],
};

export const GRIPPER_JOINT_STATE_SCHEMA = 'sensor_msgs/msg/JointState';
export const GRIPPER_JOINT_STATE_TOPIC = '/joint_states';
