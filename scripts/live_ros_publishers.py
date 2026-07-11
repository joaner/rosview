#!/usr/bin/env python3
"""Publish synthetic ROS 2 topics for ROSView live e2e / manual smoke tests.

Topics (default):
  /chatter          std_msgs/String
  /camera/image_raw sensor_msgs/Image (rgb8, small)
  /joint_states     sensor_msgs/JointState

Requires: source /opt/ros/humble/setup.bash  (or equivalent) and rclpy.
"""

from __future__ import annotations

import math
import struct
import sys
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from std_msgs.msg import String, Header
from sensor_msgs.msg import Image, JointState


class LiveDemoPublishers(Node):
    def __init__(self) -> None:
        super().__init__("rosview_live_demo_publishers")
        qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10,
        )
        self._chatter = self.create_publisher(String, "/chatter", qos)
        self._image = self.create_publisher(Image, "/camera/image_raw", qos)
        self._joints = self.create_publisher(JointState, "/joint_states", qos)
        self._seq = 0
        self._width = 64
        self._height = 48
        self.create_timer(0.1, self._tick)  # 10 Hz
        self.get_logger().info(
            "Publishing /chatter, /camera/image_raw, /joint_states at 10 Hz"
        )

    def _tick(self) -> None:
        self._seq += 1
        now = self.get_clock().now().to_msg()

        s = String()
        s.data = f"Hello from rosview live demo: {self._seq}"
        self._chatter.publish(s)

        img = Image()
        img.header = Header(stamp=now, frame_id="camera_link")
        img.height = self._height
        img.width = self._width
        img.encoding = "rgb8"
        img.is_bigendian = 0
        img.step = self._width * 3
        # Simple animated gradient so frames change over time
        phase = (self._seq * 3) % 256
        buf = bytearray(self._width * self._height * 3)
        for y in range(self._height):
            for x in range(self._width):
                i = (y * self._width + x) * 3
                buf[i] = (x * 4 + phase) % 256
                buf[i + 1] = (y * 5) % 256
                buf[i + 2] = 128
        img.data = bytes(buf)
        self._image.publish(img)

        js = JointState()
        js.header = Header(stamp=now, frame_id="")
        js.name = ["joint1", "joint2", "joint3"]
        t = self._seq * 0.1
        js.position = [math.sin(t), math.cos(t * 0.7), math.sin(t * 1.3) * 0.5]
        js.velocity = [math.cos(t), -math.sin(t * 0.7) * 0.7, math.cos(t * 1.3) * 0.65]
        js.effort = [0.0, 0.0, 0.0]
        self._joints.publish(js)


def main(args: list[str] | None = None) -> int:
    rclpy.init(args=args)
    node = LiveDemoPublishers()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
