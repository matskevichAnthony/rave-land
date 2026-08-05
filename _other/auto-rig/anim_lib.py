"""Procedural in-place animation clips: Idle, Walk, Run, Aim, Dance."""
import math

import bpy
from mathutils import Quaternion, Vector

import rig_lib

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
TWO_PI = math.pi * 2
STEP = 2


def rad(deg):
    return math.radians(deg)


class ClipBuilder:
    def __init__(self, arm_obj, forward_sign):
        self.arm = arm_obj
        self.f = forward_sign
        self.rest_inv = rig_lib.rest_rot_inverses(arm_obj)

    def start(self, name, frames):
        self.arm.animation_data_create()
        action = bpy.data.actions.new(name)
        self.arm.animation_data.action = action
        self.frames = frames
        return action

    def key(self, bone, frame, *pairs):
        self.key_quat(bone, frame, rig_lib.world_quat(*pairs))

    def key_quat(self, bone, frame, quat):
        pb = self.arm.pose.bones[bone]
        rig_lib.key_world_rotation(pb, self.rest_inv[bone], quat, frame)

    def key_loc(self, bone, frame, world_offset):
        pb = self.arm.pose.bones[bone]
        pb.location = self.rest_inv[bone] @ Vector(world_offset)
        pb.keyframe_insert('location', frame=frame)

    def aim_quat(self, bone, world_dir, parents=None):
        """World rotation pointing the bone's rest direction along world_dir.

        Keyed world rotations compose down the chain
        (child_world = W_parent @ W_child @ rest), so pass the accumulated
        parent quaternion to hit an absolute world direction.
        """
        bone_data = self.arm.pose.bones[bone].bone
        rest_dir = ((self.arm.matrix_world @ bone_data.matrix_local).to_3x3()
                    @ Vector((0, 1, 0))).normalized()
        target = Vector(world_dir).normalized()
        if parents is not None:
            target = parents.inverted() @ target
        return rest_dir.rotation_difference(target)

    def leg_fwd(self, deg):
        return (X, self.f * rad(deg))

    def knee_flex(self, deg):
        return (X, -self.f * rad(deg))

    def lean_fwd(self, deg):
        return (X, -self.f * rad(deg))

    def arm_lower(self, side, deg):
        return (Y, side * rad(deg))

    def arm_swing_fwd(self, deg):
        return (X, self.f * rad(deg))

    def elbow_fwd(self, side, deg):
        return (Z, side * self.f * rad(deg))

    def yaw(self, deg):
        return (Z, rad(deg))

    def roll(self, deg):
        return (Y, rad(deg))


ARM_DOWN_IDLE = 86


def build_idle(b):
    n = 108
    b.start('Idle', n)
    for fr in range(0, n + 1, STEP):
        t = fr / n
        breathe = math.sin(TWO_PI * 2 * t)
        sway = math.sin(TWO_PI * t)
        glance = math.sin(TWO_PI * t + 0.8) ** 3
        b.key_loc('hips', fr, (0, 0, 0.005 * breathe - 0.004 * abs(sway)))
        b.key('hips', fr, b.yaw(2.0 * sway), b.roll(2.2 * sway), b.lean_fwd(0.5 * breathe))
        b.key('spine', fr, b.roll(-0.8 * sway), b.lean_fwd(0.8 * breathe))
        b.key('chest', fr, b.lean_fwd(1.6 * breathe), b.roll(-1.0 * sway), b.yaw(-1.2 * sway))
        b.key('neck', fr, b.lean_fwd(-0.8 * breathe))
        b.key('head', fr, b.lean_fwd(-1.2 * breathe), b.yaw(9 * glance), b.roll(1.5 * sway))
        for side, s in (('L', 1), ('R', -1)):
            b.key(f'upper_arm.{side}', fr,
                  b.arm_lower(s, ARM_DOWN_IDLE + 1.5 * breathe + 1.2 * s * sway),
                  b.arm_swing_fwd(3 + 1.5 * math.sin(TWO_PI * t + s * 0.7)))
            b.key(f'forearm.{side}', fr, b.elbow_fwd(s, 16 + 2.5 * breathe))
            b.key(f'hand.{side}', fr, b.elbow_fwd(s, 4 + 2 * breathe))
            bend = 2.5 + 2.5 * (0.5 + 0.5 * s * sway)
            b.key(f'thigh.{side}', fr, b.leg_fwd(-0.5 * bend))
            b.key(f'shin.{side}', fr, b.knee_flex(bend))
            b.key(f'foot.{side}', fr, b.leg_fwd(1.5 * bend))
    return n


def build_gait(b, name, n, thigh_amp, knee_amp, knee_base, arm_down, arm_amp,
               elbow_base, lean, bob, yaw_amp):
    b.start(name, n)
    for fr in range(0, n + 1, STEP):
        phi = TWO_PI * fr / n
        phase = {'L': phi, 'R': phi + math.pi}
        b.key_loc('hips', fr, (0, 0, -bob * 0.5 + bob * math.sin(2 * phi + 0.6)))
        b.key('hips', fr, b.yaw(yaw_amp * math.sin(phi)), b.lean_fwd(lean * 0.3))
        b.key('spine', fr, b.lean_fwd(lean * 0.35), b.yaw(-yaw_amp * 0.5 * math.sin(phi)))
        b.key('chest', fr, b.lean_fwd(lean * 0.35), b.yaw(-yaw_amp * 0.7 * math.sin(phi)))
        b.key('neck', fr, b.lean_fwd(-lean * 0.3))
        b.key('head', fr, b.lean_fwd(-lean * 0.4))
        for side, s in (('L', 1), ('R', -1)):
            p = phase[side]
            swing = math.sin(p)
            flex = knee_base + knee_amp * max(0.0, math.sin(p + 2.4)) ** 1.3
            b.key(f'thigh.{side}', fr, b.leg_fwd(thigh_amp * swing))
            b.key(f'shin.{side}', fr, b.knee_flex(flex))
            b.key(f'foot.{side}', fr,
                  b.leg_fwd(-6 - 0.35 * thigh_amp * swing + 0.25 * flex))
            b.key(f'upper_arm.{side}', fr,
                  b.arm_lower(s, arm_down),
                  b.arm_swing_fwd(-arm_amp * swing))
            b.key(f'forearm.{side}', fr,
                  b.elbow_fwd(s, elbow_base + 8 * max(0.0, -swing)))
            b.key(f'hand.{side}', fr, b.elbow_fwd(s, 4))
    return n


def build_walk(b):
    return build_gait(b, 'Walk', 32, thigh_amp=27, knee_amp=42, knee_base=6,
                      arm_down=80, arm_amp=25, elbow_base=15, lean=5,
                      bob=0.018, yaw_amp=5)


def build_run(b):
    return build_gait(b, 'Run', 22, thigh_amp=42, knee_amp=68, knee_base=14,
                      arm_down=62, arm_amp=33, elbow_base=72, lean=13,
                      bob=0.032, yaw_amp=7)


AIM_TORSO_YAW = (6, 5, 7)


def build_aim(b):
    n = 54
    b.start('Aim', n)
    f = b.f
    hips_yaw, spine_yaw, chest_yaw = AIM_TORSO_YAW
    total_yaw = sum(AIM_TORSO_YAW)
    for fr in range(0, n + 1, STEP):
        t = fr / n
        breathe = math.sin(TWO_PI * t)
        waver = math.sin(TWO_PI * 2 * t + 0.7)
        b.key_loc('hips', fr, (0, 0, 0.002 * breathe))
        hips_q = rig_lib.world_quat(b.yaw(f * hips_yaw))
        b.key_quat('hips', fr, hips_q)
        spine_q = rig_lib.world_quat(b.yaw(f * spine_yaw), b.lean_fwd(1.5 + 0.4 * breathe))
        b.key_quat('spine', fr, spine_q)
        chest_q = rig_lib.world_quat(b.yaw(f * chest_yaw), b.lean_fwd(2 + 0.8 * breathe))
        b.key_quat('chest', fr, chest_q)
        b.key('neck', fr, b.yaw(-f * total_yaw * 0.4))
        b.key('head', fr, b.yaw(-f * total_yaw * 0.6))

        torso = hips_q @ spine_q @ chest_q
        barrel_sway = (Quaternion(X, rad(0.5 * breathe + 0.3 * waver))
                       @ Quaternion(Z, rad(0.4 * waver)))
        aim_arm = barrel_sway @ b.aim_quat('upper_arm.R', (0, f, -0.02), parents=torso)
        b.key_quat('upper_arm.R', fr, aim_arm)
        fore_r = b.aim_quat('forearm.R', (0.05, f, -0.04), parents=torso @ aim_arm)
        b.key_quat('forearm.R', fr, fore_r)
        hand_r = b.aim_quat('hand.R', (0, f, 0), parents=torso @ aim_arm @ fore_r)
        b.key_quat('hand.R', fr, hand_r)

        upper_l = b.aim_quat('upper_arm.L', (-0.30, 0.60 * f, -0.74), parents=torso)
        b.key_quat('upper_arm.L', fr, upper_l)
        fore_l = b.aim_quat('forearm.L', (-0.80, 0.45 * f, 0.30), parents=torso @ upper_l)
        b.key_quat('forearm.L', fr, fore_l)
        hand_l = b.aim_quat('hand.L', (-0.85, 0.40 * f, 0.20),
                            parents=torso @ upper_l @ fore_l)
        b.key_quat('hand.L', fr, hand_l)

        for side, stance in (('L', 5), ('R', -4)):
            b.key(f'thigh.{side}', fr, b.leg_fwd(stance - 3))
            b.key(f'shin.{side}', fr, b.knee_flex(7))
            b.key(f'foot.{side}', fr, b.leg_fwd(10 - stance))
    return n


def build_dance(b):
    n = 72
    b.start('Dance', n)
    for fr in range(0, n + 1, STEP):
        t = fr / n
        beat = math.sin(TWO_PI * 4 * t)
        pump = math.sin(TWO_PI * 4 * t + 1.0)
        groove = math.sin(TWO_PI * 2 * t)
        bounce = 0.5 - 0.5 * math.cos(TWO_PI * 4 * t)
        bend = 6 + 14 * bounce
        b.key_loc('hips', fr, (0, 0, -0.045 * bounce))
        hips_q = rig_lib.world_quat(b.yaw(10 * groove), b.roll(4 * groove), b.lean_fwd(2))
        b.key_quat('hips', fr, hips_q)
        spine_q = rig_lib.world_quat(b.lean_fwd(2 * beat), b.yaw(-4 * groove))
        b.key_quat('spine', fr, spine_q)
        chest_q = rig_lib.world_quat(b.lean_fwd(3 + 2 * beat), b.yaw(-6 * groove),
                                     b.roll(-3 * groove))
        b.key_quat('chest', fr, chest_q)
        b.key('neck', fr, b.lean_fwd(-3 * beat))
        b.key('head', fr, b.lean_fwd(-3 - 7 * beat), b.yaw(8 * groove))
        torso = hips_q @ spine_q @ chest_q
        for side, s in (('L', 1), ('R', -1)):
            upper_q = rig_lib.world_quat(
                b.arm_lower(s, 58 - 6 * pump),
                b.arm_swing_fwd(12 + 8 * math.sin(TWO_PI * 4 * t + s * 0.6)))
            b.key_quat(f'upper_arm.{side}', fr, upper_q)
            fist_dir = (-0.30 * s, 0.35 * b.f, 0.72 + 0.22 * pump)
            fore_q = b.aim_quat(f'forearm.{side}', fist_dir, parents=torso @ upper_q)
            b.key_quat(f'forearm.{side}', fr, fore_q)
            hand_q = b.aim_quat(f'hand.{side}', fist_dir,
                                parents=torso @ upper_q @ fore_q)
            b.key_quat(f'hand.{side}', fr, hand_q)
            b.key(f'thigh.{side}', fr, b.leg_fwd(0.5 * bend + 2 * s * groove))
            b.key(f'shin.{side}', fr, b.knee_flex(bend))
            b.key(f'foot.{side}', fr, b.leg_fwd(0.5 * bend - 2 * s * groove))
    return n


def stash_action(arm_obj, action, frames):
    track = arm_obj.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, 0, action)
    strip.action_frame_start = 0
    strip.action_frame_end = frames
    track.mute = True
    arm_obj.animation_data.action = None


CLIP_BUILDERS = (
    ('Idle', build_idle),
    ('Walk', build_walk),
    ('Run', build_run),
    ('Aim', build_aim),
    ('Dance', build_dance),
)


def build_all(arm_obj, forward_sign):
    builder = ClipBuilder(arm_obj, forward_sign)
    lengths = {}
    for name, build in CLIP_BUILDERS:
        lengths[name] = build(builder)
        stash_action(arm_obj, bpy.data.actions[name], lengths[name])
    return lengths
