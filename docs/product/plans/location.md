# Plan — 位置（L1 + L2）

> Roadmap 条目：P2「位置：L1 + L2，永不做 L3」。
> 决议：L3（geofencing + 后台定位 + push 主动提醒）**永久砍掉**——
> 后台定位权限链（Android 11+ 单独授权、电池、商店隐私审查）+ push 基建
> 成本极高，且「路过店附近 ≠ 要买」误报多，提醒即骚扰。

## L1 — Add 时记录位置

- `tastes` 加 `lat double precision` / `lng double precision`（可空）
- AddModal「Where?」字段旁加定位按钮：一次性**前台**定位
  （expo-location `getCurrentPositionAsync`，精度 balanced）
- 行为：取坐标存 lat/lng；reverse geocode（expo-location 自带）成功则
  自动填 place 文本（用户可改）；失败只存坐标不报错
- 权限：仅 `ACCESS_FINE_LOCATION` 前台权限，拒绝则按钮静默降级隐藏提示
- You 页 Location 行 = 「记录位置」开关（users 加
  `location_enabled boolean NOT NULL DEFAULT false`，默认关，opt-in）；
  关闭时 AddModal 不显示定位按钮

## L2 — Recall「附近吃过的」

- 依赖：L1 数据积累后再做
- 进入 Recall 时（location_enabled 时）一次前台定位
- 空搜索态：现「最近回忆」列表旁/下加「附近吃过的」分组——有坐标的
  记录按 haversine 距离升序，显示距离（<1km 显示米）
- 定位失败 / 无坐标记录：分组整体不渲染，不报错
- 搜索结果排序：距离只作为评分 tiebreaker，不压过文本相关性

## 不做清单（再有人提就指这里）

- 后台定位 / geofencing
- 基于位置的 push 提醒
- 店铺 POI 数据库对接（高德/Google Places）——reverse geocode 文本够用

## 验证要点

- 权限拒绝、定位超时、无网 reverse geocode 失败三条路径均静默降级
- location_enabled 默认 false；关闭后 AddModal 无定位按钮、Recall 无附近分组
- 距离排序正确性（haversine 单测，含跨时区/赤道样例）
