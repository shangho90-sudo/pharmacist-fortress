// 게임 내부 기준 좌표/물리 상수. 모든 시뮬레이션은 이 값과 고정 타임스텝(DT)만 사용한다.
export const WORLD_W = 2560; // 일반 포트리스 대비 약 2배 넓은 맵
export const WORLD_H = 1100;

export const TICK_RATE = 120; // 초당 시뮬레이션 틱
export const DT = 1 / TICK_RATE;

export const GRAVITY = 420; // px/s^2
export const MAX_LAUNCH_SPEED = 1100; // 파워 100일 때 초기 속도(px/s)
export const WIND_MAX = 10;
export const WIND_ACCEL = 7; // 바람 1단위당 수평 가속(px/s^2)

export const PROJECTILE_MAX_TICKS = TICK_RATE * 25;
export const OUT_MARGIN_X = 300;

export const TURN_SECONDS = 30;
export const TURN_TICKS = TURN_SECONDS * TICK_RATE;

export const MAX_HP = 100;
export const MAX_GAUGE = 100;
export const MOVE_PER_TURN = 140; // 턴당 이동 가능 거리(px)
export const WALK_SPEED = 48; // px/s
export const MAX_STEP_UP = 7; // 오를 수 있는 최대 단차(px)
export const MAX_STEP_DOWN = 7; // 경사 내려갈 때 지면에 붙는 최대 높이(px)
export const FOOT_HALF = 5; // 발 판정 반폭
export const BODY_RADIUS = 14; // 피격 판정 원 반지름
export const BODY_CENTER_Y = 20; // 발에서 피격 원 중심까지 높이
export const MUZZLE_HEIGHT = 25; // 발에서 발사 기준점까지 높이
export const MUZZLE_LENGTH = 29; // 발사 기준점에서 포구까지 거리
export const FALL_TERMINAL = 720; // 낙하 최대 속도
export const AIM_SPEED = 40; // 각도 변경 속도(도/초)
export const MIN_ANGLE = 0;
export const MAX_ANGLE = 90;

export const SETTLE_MIN_TICKS = Math.round(TICK_RATE * 0.9);
export const SETTLE_MAX_TICKS = TICK_RATE * 6;
export const TURN_START_TICKS = Math.round(TICK_RATE * 0.6);
