#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VP-Desk — he thong phan tich Volume Profile cho Binance USDT-M Futures.

Nguon du lieu chinh: https://fapi.binance.com (public market data, khong can API key).
Neu Binance tra 451/403 (chan dia ly) -> fallback OKX swap (--source okx).

Chay:
    python3 vp_desk.py --symbol ENAUSDT --risk 50
    python3 vp_desk.py --symbol ENAUSDT --position short:0.16208:0.162:0.154:10
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

try:
    import requests
except ImportError:  # pragma: no cover
    sys.stderr.write("Thieu thu vien: pip install requests\n")
    raise

ICT = timezone(timedelta(hours=7))
BINANCE = "https://fapi.binance.com"
OKX = "https://www.okx.com"
TIMEOUT = 10
RETRIES = 2
UA = {"User-Agent": "vp-desk/1.0"}

MS_MIN = 60_000
MS_H = 60 * MS_MIN
MS_D = 24 * MS_H


class DataError(RuntimeError):
    pass


class GeoBlocked(DataError):
    pass


# ============================================================
# HTTP
# ============================================================

def http_get(url: str, params: Optional[dict] = None) -> dict:
    last_err: Optional[Exception] = None
    for attempt in range(RETRIES + 1):
        try:
            r = requests.get(url, params=params, timeout=TIMEOUT, headers=UA)
            if r.status_code in (403, 451):
                raise GeoBlocked(
                    f"HTTP {r.status_code} từ {url} — Binance chặn truy cập từ vùng/IP này."
                )
            r.raise_for_status()
            return r.json()
        except GeoBlocked:
            raise
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < RETRIES:
                time.sleep(0.7 * (attempt + 1))
    raise DataError(f"Không lấy được {url}: {last_err}")


# ============================================================
# Cau truc du lieu
# ============================================================

@dataclass
class Candle:
    ts: int            # open time (ms)
    o: float
    h: float
    l: float
    c: float
    vol: float         # base volume
    quote: float       # quote volume
    trades: Optional[int] = None
    taker_buy: Optional[float] = None   # base volume phia taker buy


@dataclass
class Market:
    source: str
    symbol: str
    inst: str
    k15: List[Candle]
    k1h: List[Candle]
    last: Optional[float] = None
    mark: Optional[float] = None
    funding: Optional[float] = None
    funding_time: Optional[int] = None
    oi_base: Optional[float] = None
    oi_usd: Optional[float] = None
    depth: Optional[dict] = None
    notes: List[str] = field(default_factory=list)
    warns: List[str] = field(default_factory=list)


# ============================================================
# Nguon Binance
# ============================================================

def _bn_klines(symbol: str, interval: str, limit: int) -> List[Candle]:
    raw = http_get(f"{BINANCE}/fapi/v1/klines",
                   {"symbol": symbol, "interval": interval, "limit": limit})
    out: List[Candle] = []
    for k in raw:
        out.append(Candle(
            ts=int(k[0]), o=float(k[1]), h=float(k[2]), l=float(k[3]), c=float(k[4]),
            vol=float(k[5]), quote=float(k[7]), trades=int(k[8]),
            taker_buy=float(k[9]),
        ))
    return out


def _resample(cands: List[Candle], factor: int) -> List[Candle]:
    """Gop N nen lien tiep (dung khi phai lay 5m thay cho 15m)."""
    out: List[Candle] = []
    for i in range(0, len(cands) - factor + 1, factor):
        chunk = cands[i:i + factor]
        tb = None
        if all(c.taker_buy is not None for c in chunk):
            tb = sum(c.taker_buy for c in chunk)  # type: ignore[misc]
        out.append(Candle(
            ts=chunk[0].ts, o=chunk[0].o,
            h=max(c.h for c in chunk), l=min(c.l for c in chunk), c=chunk[-1].c,
            vol=sum(c.vol for c in chunk), quote=sum(c.quote for c in chunk),
            trades=sum(c.trades or 0 for c in chunk) or None, taker_buy=tb,
        ))
    return out


def fetch_binance(symbol: str, limit: int) -> Market:
    notes: List[str] = []
    warns: List[str] = []
    k15 = _bn_klines(symbol, "15m", limit)
    if len(k15) < 200:
        notes.append("Nến 15m thiếu → lấy 5m limit=1500 rồi resample x3.")
        k5 = _bn_klines(symbol, "5m", 1500)
        k15 = _resample(k5, 3)
    k1h = _bn_klines(symbol, "1h", limit)

    m = Market(source="binance", symbol=symbol, inst=symbol, k15=k15, k1h=k1h,
               notes=notes, warns=warns)
    try:
        m.last = float(http_get(f"{BINANCE}/fapi/v1/ticker/price", {"symbol": symbol})["price"])
    except DataError as e:
        warns.append(f"Thiếu ticker/price: {e}")
    try:
        pi = http_get(f"{BINANCE}/fapi/v1/premiumIndex", {"symbol": symbol})
        m.mark = float(pi["markPrice"])
        m.funding = float(pi["lastFundingRate"])
        m.funding_time = int(pi["nextFundingTime"])
    except DataError as e:
        warns.append(f"Thiếu premiumIndex: {e}")
    try:
        oi = http_get(f"{BINANCE}/fapi/v1/openInterest", {"symbol": symbol})
        m.oi_base = float(oi["openInterest"])
    except DataError as e:
        warns.append(f"Thiếu openInterest: {e}")
    try:
        d = http_get(f"{BINANCE}/fapi/v1/depth", {"symbol": symbol, "limit": 20})
        m.depth = {
            "bids": [(float(p), float(q)) for p, q in d["bids"]],
            "asks": [(float(p), float(q)) for p, q in d["asks"]],
        }
    except DataError as e:
        warns.append(f"Thiếu depth: {e}")
    return m


# ============================================================
# Nguon OKX (fallback)
# ============================================================

OKX_BAR = {"15m": "15m", "1h": "1H", "5m": "5m"}


def to_okx_inst(symbol: str) -> str:
    s = symbol.upper()
    if s.endswith("-SWAP"):
        return s
    for quote in ("USDT", "USDC", "USD"):
        if s.endswith(quote):
            return f"{s[:-len(quote)]}-{quote}-SWAP"
    return s


def _okx_ctval(inst: str) -> float:
    """1 hop dong OKX swap = ctVal don vi base. Dung de doi contracts -> base."""
    try:
        d = http_get(f"{OKX}/api/v5/public/instruments",
                     {"instType": "SWAP", "instId": inst})["data"]
        return float(d[0]["ctVal"]) if d else 1.0
    except Exception:  # noqa: BLE001
        return 1.0


def _okx_rows_to_candles(rows: Sequence[Sequence[str]]) -> List[Candle]:
    """OKX row: [ts, o, h, l, c, vol(contracts), volCcy(base), volCcyQuote, confirm]"""
    out: List[Candle] = []
    for r in rows:
        if len(r) >= 9 and r[8] == "0":
            continue  # nen chua dong
        out.append(Candle(
            ts=int(r[0]), o=float(r[1]), h=float(r[2]), l=float(r[3]), c=float(r[4]),
            vol=float(r[6]), quote=float(r[7]), trades=None, taker_buy=None,
        ))
    return out


def _okx_klines(inst: str, interval: str, limit: int) -> List[Candle]:
    bar = OKX_BAR.get(interval, interval)
    got: Dict[int, Candle] = {}
    cursor: Optional[int] = None
    # 1) /market/candles (300/req)
    for _ in range(12):
        params = {"instId": inst, "bar": bar, "limit": 300}
        if cursor:
            params["after"] = cursor
        rows = http_get(f"{OKX}/api/v5/market/candles", params).get("data") or []
        if not rows:
            break
        for c in _okx_rows_to_candles(rows):
            got[c.ts] = c
        cursor = int(rows[-1][0])
        if len(got) >= limit:
            break
        time.sleep(0.12)
    # 2) /market/history-candles (100/req) cho phan sau hon
    while len(got) < limit:
        params = {"instId": inst, "bar": bar, "limit": 100, "after": cursor}
        try:
            rows = http_get(f"{OKX}/api/v5/market/history-candles", params).get("data") or []
        except DataError:
            break
        if not rows:
            break
        for c in _okx_rows_to_candles(rows):
            got[c.ts] = c
        cursor = int(rows[-1][0])
        time.sleep(0.12)
    ordered = [got[t] for t in sorted(got)]
    return ordered[-limit:]


def fetch_okx(symbol: str, limit: int) -> Market:
    inst = to_okx_inst(symbol)
    notes = [f"Nguồn OKX swap ({inst}). Volume hợp đồng đã quy về base coin qua ctVal."]
    warns: List[str] = []
    k15 = _okx_klines(inst, "15m", limit)
    if len(k15) < 200:
        notes.append("Nến 15m thiếu → lấy 5m rồi resample x3.")
        k15 = _resample(_okx_klines(inst, "5m", 1500), 3)
    k1h = _okx_klines(inst, "1h", limit)
    if not k15:
        raise DataError(f"OKX không trả nến cho {inst}.")

    m = Market(source="okx", symbol=symbol, inst=inst, k15=k15, k1h=k1h,
               notes=notes, warns=warns)
    warns.append("OKX không công bố taker buy volume theo nến → delta chỉ tính từ nến xanh/đỏ.")
    try:
        t = http_get(f"{OKX}/api/v5/market/ticker", {"instId": inst})["data"][0]
        m.last = float(t["last"])
    except Exception as e:  # noqa: BLE001
        warns.append(f"Thiếu ticker: {e}")
    try:
        mp = http_get(f"{OKX}/api/v5/public/mark-price",
                      {"instType": "SWAP", "instId": inst})["data"][0]
        m.mark = float(mp["markPx"])
    except Exception as e:  # noqa: BLE001
        warns.append(f"Thiếu mark price: {e}")
    try:
        fr = http_get(f"{OKX}/api/v5/public/funding-rate", {"instId": inst})["data"][0]
        m.funding = float(fr["fundingRate"])
        m.funding_time = int(fr["fundingTime"])
    except Exception as e:  # noqa: BLE001
        warns.append(f"Thiếu funding: {e}")
    try:
        oi = http_get(f"{OKX}/api/v5/public/open-interest",
                      {"instType": "SWAP", "instId": inst})["data"][0]
        ctval = _okx_ctval(inst)
        m.oi_base = float(oi["oi"]) * ctval
        m.oi_usd = float(oi.get("oiUsd") or 0) or None
    except Exception as e:  # noqa: BLE001
        warns.append(f"Thiếu openInterest: {e}")
    try:
        b = http_get(f"{OKX}/api/v5/market/books", {"instId": inst, "sz": 20})["data"][0]
        ctval = _okx_ctval(inst)
        m.depth = {
            "bids": [(float(r[0]), float(r[1]) * ctval) for r in b["bids"]],
            "asks": [(float(r[0]), float(r[1]) * ctval) for r in b["asks"]],
        }
    except Exception as e:  # noqa: BLE001
        warns.append(f"Thiếu depth: {e}")
    return m


def fetch_market(symbol: str, source: str, limit: int) -> Market:
    if source == "binance":
        return fetch_binance(symbol, limit)
    if source == "okx":
        return fetch_okx(symbol, limit)
    # auto
    try:
        return fetch_binance(symbol, limit)
    except GeoBlocked as e:
        sys.stderr.write(
            f"[VP-Desk] {e}\n"
            "[VP-Desk] data-api.binance.vision KHONG phuc vu futures -> khong dung duoc.\n"
            "[VP-Desk] Tu dong fallback --source okx.\n")
        m = fetch_okx(symbol, limit)
        m.warns.insert(0, "Binance fapi trả 451/403 (chặn địa lý) → toàn bộ số liệu dưới đây lấy từ OKX swap.")
        return m
    except DataError as e:
        sys.stderr.write(f"[VP-Desk] Binance loi: {e} -> thu OKX.\n")
        m = fetch_okx(symbol, limit)
        m.warns.insert(0, f"Binance lỗi ({e}) → số liệu lấy từ OKX swap.")
        return m


# ============================================================
# Volume Profile
# ============================================================

def bin_size_for(price: float) -> float:
    if price >= 1:
        return 0.01
    if price >= 0.1:
        return 0.001
    if price >= 0.01:
        return 0.0005
    return 0.0001


def choose_bin(price: float, lo: float, hi: float,
               max_bins: int = 1200) -> Tuple[float, Optional[str]]:
    """
    Bin theo bang quy dinh; neu range/bin vuot max_bins (vd BTC gia 6 chu so voi bin 0.01)
    thi noi bin theo buoc 1/2/5 cho den khi so bin hop ly, va ghi chu ro rang.
    """
    base = bin_size_for(price)
    span = max(hi - lo, base)
    if span / base <= max_bins:
        return base, None
    bs = base
    steps = (2.0, 2.5, 2.0)   # 1 -> 2 -> 5 -> 10
    i = 0
    while span / bs > max_bins and bs < span:
        bs *= steps[i % 3]
        i += 1
    bs = float(f"{bs:.10g}")
    note = (f"Bin theo bảng quy định là {base:g}, nhưng range 15D ({lo:g}–{hi:g}) sẽ tạo "
            f"{int(span/base):,} bin — quá mịn để đọc và quá nặng để tính. Đã nới bin lên "
            f"{bs:g} ({int(span/bs):,} bin).")
    return bs, note


def decimals_for(bs: float) -> int:
    s = f"{bs:.10f}".rstrip("0")
    return len(s.split(".")[1]) + 1 if "." in s else 2


def bin_index(price: float, bs: float) -> int:
    return int(math.floor(round(price / bs, 9)))


def bin_center(idx: int, bs: float) -> float:
    return (idx + 0.5) * bs


def bin_low(idx: int, bs: float) -> float:
    return idx * bs


def bin_high(idx: int, bs: float) -> float:
    return (idx + 1) * bs


@dataclass
class Node:
    """Mot 'nha' volume: dinh + bien tren/duoi."""
    kind: str          # HVN | LVN
    idx: int
    price: float       # gia tai dinh (center)
    vol: float
    share: float
    lo: float          # bien duoi node
    hi: float          # bien tren node


@dataclass
class Profile:
    name: str
    bs: float
    hist: Dict[int, float]
    total: float
    n_candles: int
    t_from: int
    t_to: int
    poc_idx: int = 0
    poc_vol: float = 0.0
    poc_share: float = 0.0
    val_idx: int = 0
    vah_idx: int = 0
    va_vol: float = 0.0
    hvns: List[Node] = field(default_factory=list)
    lvns: List[Node] = field(default_factory=list)
    poc_range_idx: Optional[int] = None    # POC theo range-distribution
    delta: Dict[str, float] = field(default_factory=dict)
    shape: str = "n/a"
    hi_price: float = 0.0
    lo_price: float = 0.0

    @property
    def poc(self) -> float:
        return bin_center(self.poc_idx, self.bs)

    @property
    def val(self) -> float:
        return bin_low(self.val_idx, self.bs)

    @property
    def vah(self) -> float:
        return bin_high(self.vah_idx, self.bs)

    @property
    def poc_range(self) -> Optional[float]:
        return None if self.poc_range_idx is None else bin_center(self.poc_range_idx, self.bs)


def build_hist(candles: Sequence[Candle], bs: float, method: str = "close") -> Dict[int, float]:
    hist: Dict[int, float] = defaultdict(float)
    for c in candles:
        if c.vol <= 0:
            continue
        if method == "close":
            hist[bin_index(c.c, bs)] += c.vol
        else:  # range distribution: rai deu volume tu low -> high
            lo, hi = bin_index(c.l, bs), bin_index(c.h, bs)
            n = hi - lo + 1
            if n <= 0:
                continue
            part = c.vol / n
            for i in range(lo, hi + 1):
                hist[i] += part
    return dict(hist)


def value_area(hist: Dict[int, float], poc_idx: int, total: float,
               pct: float = 0.70) -> Tuple[int, int, float]:
    if not hist or total <= 0:
        return poc_idx, poc_idx, 0.0
    idxs = sorted(hist)
    lo_min, hi_max = idxs[0], idxs[-1]
    target = total * pct
    lo = hi = poc_idx
    acc = hist.get(poc_idx, 0.0)
    guard = 0
    while acc < target and (lo > lo_min or hi < hi_max) and guard < 100000:
        guard += 1
        up = sum(hist.get(hi + k, 0.0) for k in (1, 2)) if hi < hi_max else -1.0
        dn = sum(hist.get(lo - k, 0.0) for k in (1, 2)) if lo > lo_min else -1.0
        if up >= dn:
            for k in (1, 2):
                if hi < hi_max:
                    hi += 1
                    acc += hist.get(hi, 0.0)
                if acc >= target:
                    break
        else:
            for k in (1, 2):
                if lo > lo_min:
                    lo -= 1
                    acc += hist.get(lo, 0.0)
                if acc >= target:
                    break
    return lo, hi, acc


def node_edges(hist: Dict[int, float], peak: int, bs: float,
               frac: float = 0.5, max_span: int = 4) -> Tuple[float, float]:
    """
    Bien cua node: noi rong tu dinh CHI KHI volume con di xuong va con >= frac*dinh.
    Gap dinh len tro lai = da sang node khac -> dung. Nho vay node khong nuot ca range.
    """
    pv = hist.get(peak, 0.0)
    thr = pv * frac
    lo = hi = peak
    prev = pv
    for _ in range(max_span):
        v = hist.get(lo - 1, 0.0)
        if v <= 0 or v > prev or v < thr:
            break
        lo -= 1
        prev = v
    prev = pv
    for _ in range(max_span):
        v = hist.get(hi + 1, 0.0)
        if v <= 0 or v > prev or v < thr:
            break
        hi += 1
        prev = v
    return bin_low(lo, bs), bin_high(hi, bs)


def find_hvn(hist: Dict[int, float], total: float, bs: float,
             min_share: float = 0.012, top: int = 12) -> List[Node]:
    if total <= 0 or not hist:
        return []
    peaks: List[Tuple[int, float]] = []
    for i, v in hist.items():
        if v / total < min_share:
            continue
        left, right = hist.get(i - 1, 0.0), hist.get(i + 1, 0.0)
        if v >= left and v >= right and (v > left or v > right):
            peaks.append((i, v))
    if not peaks:
        # profile qua phang: lay cac bin manh nhat
        peaks = [(i, v) for i, v in hist.items() if v / total >= min_share]
    # gop dinh dinh sat nhau (cach <= 1 bin): giu dinh manh nhat
    peaks.sort(key=lambda t: t[0])
    merged: List[Tuple[int, float]] = []
    for i, v in peaks:
        if merged and i - merged[-1][0] <= 1:
            if v > merged[-1][1]:
                merged[-1] = (i, v)
        else:
            merged.append((i, v))
    merged.sort(key=lambda t: t[1], reverse=True)
    out: List[Node] = []
    for i, v in merged[:top]:
        lo, hi = node_edges(hist, i, bs)
        out.append(Node("HVN", i, bin_center(i, bs), v, v / total, lo, hi))
    return out


def find_lvn(hist: Dict[int, float], total: float, bs: float,
             max_share: float = 0.008, top: int = 10) -> List[Node]:
    if total <= 0 or not hist:
        return []
    idxs = sorted(hist)
    lo_i, hi_i = idxs[0], idxs[-1]
    troughs: List[Node] = []
    for i in range(lo_i + 1, hi_i):
        v = hist.get(i, 0.0)
        if v / total > max_share:
            continue
        left, right = hist.get(i - 1, 0.0), hist.get(i + 1, 0.0)
        if v <= left and v <= right:
            troughs.append(Node("LVN", i, bin_center(i, bs), v, v / total,
                                bin_low(i, bs), bin_high(i, bs)))
    # gop cac khe lien tiep -> giu khe mong nhat moi cum
    troughs.sort(key=lambda n: n.idx)
    merged: List[Node] = []
    for n in troughs:
        if merged and n.idx - merged[-1].idx <= 1:
            if n.vol < merged[-1].vol:
                merged[-1] = n
        else:
            merged.append(n)
    merged.sort(key=lambda n: n.vol)
    return merged[:top]


def delta_stats(candles: Sequence[Candle]) -> Dict[str, float]:
    up = sum(c.vol for c in candles if c.c > c.o)
    dn = sum(c.vol for c in candles if c.c < c.o)
    fl = sum(c.vol for c in candles if c.c == c.o)
    tot = up + dn + fl
    d: Dict[str, float] = {
        "up": up, "down": dn, "flat": fl, "total": tot,
        "delta": up - dn,
        "delta_pct": ((up - dn) / tot * 100.0) if tot else 0.0,
    }
    if candles and all(c.taker_buy is not None for c in candles):
        tb = sum(c.taker_buy for c in candles)  # type: ignore[misc]
        ts = sum(c.vol for c in candles) - tb
        d["taker_buy"] = tb
        d["taker_sell"] = ts
        d["taker_delta"] = tb - ts
        d["taker_delta_pct"] = ((tb - ts) / (tb + ts) * 100.0) if (tb + ts) else 0.0
    return d


def classify_shape(p: Profile) -> str:
    if p.total <= 0 or p.vah <= p.val:
        return "n/a"
    pos = (p.poc - p.val) / (p.vah - p.val)
    va_w = p.vah - p.val
    rng = max(p.hi_price - p.lo_price, 1e-12)
    thin = p.poc_share >= 0.05 and (va_w / rng) <= 0.35
    if pos >= 0.65:
        base = "P — volume dồn nửa trên VA, đáy dưới mỏng, mất POC là thủng nhanh"
    elif pos <= 0.35:
        base = "b — volume dồn nửa dưới VA, trần trên mỏng, vượt POC là bay nhanh"
    else:
        base = "D — cân bằng quanh POC, thị trường đang chấp nhận vùng giá này"
    return base + (" · thin peak: node hẹp, volume đặc một chỗ" if thin else "")


def build_profile(name: str, candles: Sequence[Candle], bs: float) -> Profile:
    hist = build_hist(candles, bs, "close")
    total = sum(hist.values())
    p = Profile(name=name, bs=bs, hist=hist, total=total, n_candles=len(candles),
                t_from=candles[0].ts if candles else 0,
                t_to=candles[-1].ts if candles else 0)
    if not hist or total <= 0:
        return p
    p.poc_idx = max(hist, key=lambda i: hist[i])
    p.poc_vol = hist[p.poc_idx]
    p.poc_share = p.poc_vol / total
    p.val_idx, p.vah_idx, p.va_vol = value_area(hist, p.poc_idx, total)
    p.hi_price = max(c.h for c in candles)
    p.lo_price = min(c.l for c in candles)
    p.hvns = find_hvn(hist, total, bs)
    p.lvns = find_lvn(hist, total, bs)
    rh = build_hist(candles, bs, "range")
    if rh:
        p.poc_range_idx = max(rh, key=lambda i: rh[i])
    p.delta = delta_stats(candles)
    p.shape = classify_shape(p)
    return p


def slice_window(candles: Sequence[Candle], hours: float, now_ms: int) -> List[Candle]:
    cutoff = now_ms - int(hours * MS_H)
    return [c for c in candles if c.ts >= cutoff]


# ============================================================
# Doc cau truc: S/R map, path, reject/accept
# ============================================================

@dataclass
class Level:
    price: float
    kind: str            # HVN | POC | VAH | VAL | LVN
    labels: List[str]
    weight: float
    lo: float
    hi: float

    @property
    def label(self) -> str:
        uniq = list(dict.fromkeys(self.labels))
        if self.kind != "LVN":
            keep = [x for x in uniq if not x.startswith("LVN")]
            uniq = keep or uniq
        head = " + ".join(uniq[:4])
        return head + (f" (+{len(uniq)-4} nhãn khác)" if len(uniq) > 4 else "")


def cluster_levels(levels: List[Level], bs: float) -> List[Level]:
    """Gop cac muc cach nhau <= 1 bin thanh 1 muc."""
    if not levels:
        return []
    levels = sorted(levels, key=lambda l: l.price)
    out: List[Level] = [levels[0]]
    for lv in levels[1:]:
        prev = out[-1]
        if abs(lv.price - prev.price) <= bs * 1.001:
            rank = {"POC": 3, "HVN": 2, "VAH": 1, "VAL": 1, "LVN": 0}
            keep_kind = prev.kind if rank.get(prev.kind, 0) >= rank.get(lv.kind, 0) else lv.kind
            prev.labels = prev.labels + lv.labels
            prev.weight = max(prev.weight, lv.weight)
            prev.lo = min(prev.lo, lv.lo)
            prev.hi = max(prev.hi, lv.hi)
            prev.kind = keep_kind
            if rank.get(lv.kind, 0) > rank.get(prev.kind, 0):
                prev.price = lv.price
        else:
            out.append(lv)
    return out


def build_levels(profiles: Dict[str, Profile], bs: float) -> List[Level]:
    lv: List[Level] = []

    def add(price, kind, label, weight, lo=None, hi=None):
        lv.append(Level(price, kind, [label], weight,
                        lo if lo is not None else price - bs / 2,
                        hi if hi is not None else price + bs / 2))

    for wname in ("15D", "7D", "48H", "24H", "12H", "6H"):
        p = profiles.get(wname)
        if not p or p.total <= 0:
            continue
        add(p.poc, "POC", f"POC {wname}", p.poc_share)
        if wname in ("15D", "7D", "48H", "24H"):
            add(p.vah, "VAH", f"VAH {wname}", 0.0)
            add(p.val, "VAL", f"VAL {wname}", 0.0)
        n_hvn = 8 if wname in ("15D", "7D") else 5
        for n in p.hvns[:n_hvn]:
            add(n.price, "HVN", f"HVN {wname} {n.share*100:.1f}%", n.share, n.lo, n.hi)
        n_lvn = 6 if wname in ("15D", "7D") else 4
        for n in p.lvns[:n_lvn]:
            add(n.price, "LVN", f"LVN {wname}", n.share, n.lo, n.hi)
    return cluster_levels(lv, bs)


def hvn_clusters(nodes: Sequence[Node], bs: float) -> List[Node]:
    """
    Gop cac HVN chong lan nhau thanh 'nha' (cluster). Chi gop khi chong lan that su
    (> nua bin) -> ket qua la cac cum ROI NHAU, khong bao gio chong nhau, nen ban do
    S/R va quyet dinh luon nhat quan.
    """
    if not nodes:
        return []
    ivs = sorted(((n.lo, n.hi, n) for n in nodes), key=lambda t: t[0])
    clusters: List[Tuple[float, float, Node]] = []
    cur_lo, cur_hi, peak = ivs[0]
    for lo, hi, n in ivs[1:]:
        if lo < cur_hi - bs * 0.5:
            cur_hi = max(cur_hi, hi)
            if n.vol > peak.vol:
                peak = n
        else:
            clusters.append((cur_lo, cur_hi, peak))
            cur_lo, cur_hi, peak = lo, hi, n
    clusters.append((cur_lo, cur_hi, peak))
    out = [Node("HVN", p.idx, p.price, p.vol, p.share, lo, hi) for lo, hi, p in clusters]
    out.sort(key=lambda n: n.lo)
    return out


def cluster_at(clusters: Sequence[Node], price: float) -> Optional[Node]:
    inside = [c for c in clusters if c.lo <= price <= c.hi]
    return max(inside, key=lambda c: c.share) if inside else None


def cluster_above(clusters: Sequence[Node], price: float) -> Optional[Node]:
    pool = [c for c in clusters if c.lo > price]
    return min(pool, key=lambda c: c.lo) if pool else None


def cluster_below(clusters: Sequence[Node], price: float) -> Optional[Node]:
    pool = [c for c in clusters if c.hi < price]
    return max(pool, key=lambda c: c.hi) if pool else None


@dataclass
class Signal:
    kind: str          # reject_down | reject_up | accept_above | accept_below | none
    ago: int           # so nen 15m truoc (0 = nen vua dong)
    detail: str


def scan_reject(k15: Sequence[Candle], ref: float, direction: str,
                lookback: int = 12) -> Signal:
    """
    direction='up'  : ref la mep tuong -> tim reject GIAM (wick cham ref, dong duoi ref).
    direction='down': ref la mep san   -> tim reject TANG (wick cham ref, dong tren ref).
    """
    tail = list(k15[-lookback:])
    n = len(tail)
    for i in range(n - 1, -1, -1):
        c = tail[i]
        ago = n - 1 - i
        if direction == "up":
            if c.h >= ref and c.c < ref and c.c <= c.o:
                return Signal("reject_down", ago,
                              f"nến 15m chạm {ref:.6g} rồi đóng {c.c:.6g} dưới mép node")
        else:
            if c.l <= ref and c.c > ref and c.c >= c.o:
                return Signal("reject_up", ago,
                              f"nến 15m chạm {ref:.6g} rồi đóng {c.c:.6g} trên mép node")
    return Signal("none", -1, f"chưa có nến 15m reject tại {ref:.6g} trong {lookback} nến gần nhất")


def scan_accept(k15: Sequence[Candle], node: Node, direction: str,
                lookback: int = 8) -> Signal:
    """Accept = 2 nến 15m liên tiếp đóng cùng phía ngoài node."""
    tail = list(k15[-lookback:])
    for i in range(len(tail) - 1, 0, -1):
        a, b = tail[i - 1], tail[i]
        ago = len(tail) - 1 - i
        if direction == "up" and a.c > node.hi and b.c > node.hi:
            return Signal("accept_above", ago, f"2 nến 15m đóng trên {node.hi:.6g}")
        if direction == "down" and a.c < node.lo and b.c < node.lo:
            return Signal("accept_below", ago, f"2 nến 15m đóng dưới {node.lo:.6g}")
    return Signal("none", -1, "chưa accept")


def zone_volumes(profile: Profile, price: float) -> List[Tuple[str, float, float, float]]:
    """Tra ve (nhan, gia_lo, gia_hi, share) cho tung vanh dai quanh gia."""
    bands = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 5.0), (5.0, 8.0)]
    rows: List[Tuple[str, float, float, float]] = []
    if profile.total <= 0:
        return rows
    bs = profile.bs

    def vol_between(a: float, b: float) -> float:
        ia, ib = bin_index(a, bs), bin_index(b, bs)
        return sum(v for i, v in profile.hist.items() if ia <= i <= ib)

    for a, b in reversed(bands):
        lo, hi = price * (1 + a / 100), price * (1 + b / 100)
        rows.append((f"+{a:g}% .. +{b:g}% trên giá", lo, hi, vol_between(lo, hi) / profile.total))
    for a, b in bands:
        lo, hi = price * (1 - b / 100), price * (1 - a / 100)
        rows.append((f"{-a:g}% .. -{b:g}% dưới giá", lo, hi, vol_between(lo, hi) / profile.total))
    above8 = sum(v for i, v in profile.hist.items() if bin_center(i, bs) > price * 1.08)
    below8 = sum(v for i, v in profile.hist.items() if bin_center(i, bs) < price * 0.92)
    rows.insert(0, ("> +8% trên giá", price * 1.08, profile.hi_price, above8 / profile.total))
    rows.append(("< -8% dưới giá", profile.lo_price, price * 0.92, below8 / profile.total))
    return rows


def path_steps(levels: Sequence[Level], price: float, direction: str,
               min_gap_pct: float, n: int = 4) -> List[Level]:
    """Cac bac gia phai xuyen lan luot. Cam nhay coc."""
    if direction == "down":
        cands = [l for l in levels if l.price < price]
        cands.sort(key=lambda l: l.price, reverse=True)
    else:
        cands = [l for l in levels if l.price > price]
        cands.sort(key=lambda l: l.price)
    out: List[Level] = []
    ref = price
    for l in cands:
        if abs(l.price - ref) / max(price, 1e-12) * 100 < min_gap_pct:
            continue
        out.append(l)
        ref = l.price
        if len(out) >= n:
            break
    return out


# ============================================================
# Ke hoach lenh — 4 so bat buoc
# ============================================================

@dataclass
class Plan:
    side: str                      # SHORT | LONG
    active: bool                   # True = du dieu kien vao ngay
    trigger: str                   # dieu kien kich hoat neu chua active
    entry: float
    entry_lo: float
    entry_hi: float
    stop: float
    tp1: float
    tp2: float
    entry_note: str
    stop_note: str
    tp1_note: str
    tp2_note: str
    rr1: float
    rr2: float
    invalidation: str
    warnings: List[str] = field(default_factory=list)


def _pick_targets(levels: Sequence[Level], entry: float, side: str,
                  price: float, min_gap_pct: float) -> Tuple[Optional[Level], Optional[Level]]:
    """TP1 = bac dau tien truoc mat lenh. TP2 = HVN/POC ke tiep. Khong nhay coc."""
    direction = "down" if side == "SHORT" else "up"
    steps = path_steps(levels, entry, direction, min_gap_pct, n=6)
    if not steps:
        return None, None
    tp1 = steps[0]
    tp2 = None
    # TP2 = bac KE TIEP tren path. Chi bo qua bac la LVN (khe rong, gia khong dung lai o do),
    # tuyet doi khong bo qua mot bac HVN/POC/VA dang co nguoi dung.
    for l in steps[1:]:
        if l.kind != "LVN":
            tp2 = l
            break
    if tp2 is None and len(steps) > 1:
        tp2 = steps[1]
    return tp1, tp2


def build_plan(side: str, node: Node, levels: Sequence[Level], price: float,
               bs: float, active: bool, trigger: str,
               k15: Sequence[Candle]) -> Optional[Plan]:
    min_gap_pct = max(0.35, bs / price * 100 * 2)
    warns: List[str] = []

    if side == "SHORT":
        entry_lo, entry_hi = node.lo, node.hi
        entry = entry_lo if price < entry_lo else min(max(price, entry_lo), entry_hi)
        stop = node.hi + bs
        if stop <= entry:
            stop = entry + bs * 2
        tp1_l, tp2_l = _pick_targets(levels, entry, "SHORT", price, min_gap_pct)
        if tp1_l is None:
            return None
        tp1 = tp1_l.price
        tp2 = tp2_l.price if tp2_l else tp1 - (entry - tp1)
        risk = stop - entry
        rr1 = (entry - tp1) / risk if risk > 0 else 0.0
        rr2 = (entry - tp2) / risk if risk > 0 else 0.0
        inval = (f"Nến 15m ĐÓNG trên {stop:.6g} = thị trường chấp nhận giá trên tường "
                 f"→ luận điểm chết, đóng lệnh. Wick lên trên {stop:.6g} nhưng đóng lại dưới "
                 "thì luận điểm CHƯA chết — không đóng sớm, cũng không đảo lệnh.")
        if abs(entry - node.lo) <= bs:
            where = f"mép dưới tường HVN {node.lo:.6g}–{node.hi:.6g}"
        elif abs(entry - node.hi) <= bs:
            where = (f"sát trần cụm HVN {node.lo:.6g}–{node.hi:.6g} — giá đang ở TRONG nhà, "
                     "ngay dưới mép trên")
        else:
            where = f"trong thân cụm HVN {node.lo:.6g}–{node.hi:.6g}"
        entry_note = f"{where} (đỉnh {node.price:.6g}, {node.share*100:.1f}% volume)"
    else:
        entry_lo, entry_hi = node.lo, node.hi
        entry = entry_hi if price > entry_hi else min(max(price, entry_lo), entry_hi)
        stop = node.lo - bs
        if stop >= entry:
            stop = entry - bs * 2
        tp1_l, tp2_l = _pick_targets(levels, entry, "LONG", price, min_gap_pct)
        if tp1_l is None:
            return None
        tp1 = tp1_l.price
        tp2 = tp2_l.price if tp2_l else tp1 + (tp1 - entry)
        risk = entry - stop
        rr1 = (tp1 - entry) / risk if risk > 0 else 0.0
        rr2 = (tp2 - entry) / risk if risk > 0 else 0.0
        inval = (f"Nến 15m ĐÓNG dưới {stop:.6g} = thị trường chấp nhận giá dưới sàn "
                 f"→ luận điểm chết, đóng lệnh. Wick thủng {stop:.6g} nhưng đóng lại trên "
                 "thì luận điểm CHƯA chết — không đóng sớm, cũng không đảo lệnh.")
        if abs(entry - node.hi) <= bs:
            where = f"mép trên sàn HVN {node.lo:.6g}–{node.hi:.6g}"
        elif abs(entry - node.lo) <= bs:
            where = (f"sát đáy cụm HVN {node.lo:.6g}–{node.hi:.6g} — giá đang ở TRONG nhà, "
                     "ngay trên mép dưới")
        else:
            where = f"trong thân cụm HVN {node.lo:.6g}–{node.hi:.6g}"
        entry_note = f"{where} (đỉnh {node.price:.6g}, {node.share*100:.1f}% volume)"

    stop_pct_pre = abs(stop - entry) / entry * 100
    width_pct = (node.hi - node.lo) / price * 100
    if stop_pct_pre > 3.0:
        warns.append(f"Stop cách entry {stop_pct_pre:.2f}% vì cụm HVN rộng {width_pct:.2f}% giá "
                     "và stop phải nằm ngoài cả cụm. Đây là nhà rộng, không phải node mỏng: "
                     "giảm size cho khớp, hoặc chờ giá vào sát mép hơn — đừng thu ngắn stop.")
    if rr1 < 0.8:
        warns.append(f"R:R đến TP1 chỉ {rr1:.2f} — bậc đầu tiên quá gần stop. "
                     "Giảm size, hoặc chờ giá lùi sát mép node hơn để stop ngắn lại.")
    stop_pct = abs(stop - entry) / entry * 100
    if stop_pct < bs / price * 100 * 1.5:
        warns.append("Stop quá sát entry so với độ rộng bin — dễ bị quét wick.")

    return Plan(
        side=side, active=active, trigger=trigger,
        entry=entry, entry_lo=entry_lo, entry_hi=entry_hi,
        stop=stop, tp1=tp1, tp2=tp2,
        entry_note=entry_note,
        stop_note=(f"ngoài đỉnh cụm HVN {node.hi:.6g} + 1 bin ({bs:g})" if side == "SHORT"
                   else f"ngoài đáy cụm HVN {node.lo:.6g} − 1 bin ({bs:g})"),
        tp1_note=tp1_l.label, tp2_note=(tp2_l.label if tp2_l else "suy ra từ bậc 1 (thiếu mức volume kế tiếp)"),
        rr1=rr1, rr2=rr2, invalidation=inval, warnings=warns,
    )


@dataclass
class Decision:
    verdict: str            # LONG | SHORT | WAIT
    reasons: List[str]
    plan: Optional[Plan]
    alt_plan: Optional[Plan]
    node_up: Optional[Node]
    node_down: Optional[Node]
    ref_up: Optional[float]
    ref_down: Optional[float]
    sig_up: Signal
    sig_down: Signal
    acc_up: Signal
    acc_down: Signal
    clusters: List[Node]


def decide(price: float, k15: Sequence[Candle], profiles: Dict[str, Profile],
           levels: Sequence[Level], bs: float) -> Decision:
    pool: List[Node] = []
    p_long = profiles.get("7D") or profiles.get("15D")
    p_short = profiles.get("24H") or profiles.get("48H")
    if p_long:
        pool.extend(p_long.hvns[:10])
    if p_short:
        pool.extend(p_short.hvns[:6])
    clusters = hvn_clusters(pool, bs)
    cur = cluster_at(clusters, price)
    above = cluster_above(clusters, price)
    below = cluster_below(clusters, price)
    tol = max(bs, price * 0.0025)

    # Tuong tren (R) va san duoi (S) + muc tham chieu de bat reject
    if cur is not None and price >= cur.hi - tol:
        R, ref_up = cur, cur.hi
    elif above is not None:
        R, ref_up = above, above.lo
    elif cur is not None:
        R, ref_up = cur, cur.hi
    else:
        R, ref_up = None, None

    if cur is not None and price <= cur.lo + tol:
        S, ref_dn = cur, cur.lo
    elif below is not None:
        S, ref_dn = below, below.hi
    elif cur is not None:
        S, ref_dn = cur, cur.lo
    else:
        S, ref_dn = None, None

    sig_up = (scan_reject(k15, ref_up, "up") if R is not None
              else Signal("none", -1, "không có HVN phía trên trong dữ liệu"))
    sig_dn = (scan_reject(k15, ref_dn, "down") if S is not None
              else Signal("none", -1, "không có HVN phía dưới trong dữ liệu"))
    acc_up = scan_accept(k15, R, "up") if R is not None else Signal("none", -1, "")
    acc_dn = scan_accept(k15, S, "down") if S is not None else Signal("none", -1, "")

    dist_up = abs(ref_up - price) / price * 100 if ref_up is not None else 99.0
    dist_dn = abs(price - ref_dn) / price * 100 if ref_dn is not None else 99.0
    at_up = ref_up is not None and dist_up * price / 100 <= tol
    at_dn = ref_dn is not None and dist_dn * price / 100 <= tol

    reasons: List[str] = []
    if R is not None:
        reasons.append(f"Tường trên: cụm HVN {R.lo:.6g}–{R.hi:.6g} (đỉnh {R.price:.6g}, "
                       f"{R.share*100:.1f}% volume). Mép cần theo dõi: {ref_up:.6g}, "
                       f"cách giá {dist_up:.2f}%.")
    if S is not None:
        reasons.append(f"Sàn dưới: cụm HVN {S.lo:.6g}–{S.hi:.6g} (đỉnh {S.price:.6g}, "
                       f"{S.share*100:.1f}% volume). Mép cần theo dõi: {ref_dn:.6g}, "
                       f"cách giá {dist_dn:.2f}%.")

    in_middle = cur is not None and not at_up and not at_dn
    in_gap = cur is None and not at_up and not at_dn and dist_up > 1.2 and dist_dn > 1.2
    # "vua roi node" chi dung khi gia HIEN DANG o ngoai moi cum; neu gia da quay lai
    # trong node thi do la retest, khong phai da roi di.
    just_left = cur is None and ((acc_up.kind == "accept_above" and acc_up.ago <= 2)
                                 or (acc_dn.kind == "accept_below" and acc_dn.ago <= 2))

    verdict = "WAIT"
    if in_gap:
        reasons.append(f"Giá đang Ở GIỮA hai nhà volume (cách tường {dist_up:.2f}%, cách sàn "
                       f"{dist_dn:.2f}%). Vùng này không có ai giữ giá — vào đây là đoán, "
                       "không phải giao dịch theo profile.")
    elif in_middle:
        reasons.append(f"Giá nằm GIỮA THÂN node {cur.lo:.6g}–{cur.hi:.6g}, chưa chạm mép nào. "
                       "Trong thân node giá dao động hai chiều; vào ở đây là vào giữa nhà.")
    elif just_left:
        reasons.append("Giá VỪA rời khỏi node (đã accept). Đuổi giá lúc này chính là lỗi "
                       "'vào muộn'. Chờ retest lại mép node rồi mới hành động.")
    elif at_up and sig_up.kind == "reject_down" and sig_up.ago <= 3:
        verdict = "SHORT"
        reasons.append(f"Giá ở MÉP tường trên và ĐÃ reject: {sig_up.detail} "
                       f"({sig_up.ago} nến trước).")
    elif at_dn and sig_dn.kind == "reject_up" and sig_dn.ago <= 3:
        verdict = "LONG"
        reasons.append(f"Giá ở MÉP sàn dưới và ĐÃ reject: {sig_dn.detail} "
                       f"({sig_dn.ago} nến trước).")
    elif at_up:
        reasons.append("Giá chạm mép tường nhưng CHƯA có nến 15m reject. Đây đúng là chỗ hay "
                       "'vào sớm' rồi bị kéo qua node. Chờ nến đóng ngược phía node.")
    elif at_dn:
        reasons.append("Giá chạm mép sàn nhưng CHƯA có nến 15m reject. Chờ nến 15m đóng trên "
                       "mép sàn rồi mới long.")
    else:
        reasons.append("Chưa ở mép nhà nào và cũng chưa reject — không có lý do vào lệnh.")

    sp = lp = None
    if R is not None:
        trig = ("Kích hoạt ngay." if verdict == "SHORT" else
                f"Kích hoạt khi nến 15m chạm {ref_up:.6g} rồi ĐÓNG dưới {ref_up:.6g}.")
        sp = build_plan("SHORT", R, levels, price, bs, verdict == "SHORT", trig, k15)
    if S is not None:
        trig = ("Kích hoạt ngay." if verdict == "LONG" else
                f"Kích hoạt khi nến 15m chạm {ref_dn:.6g} rồi ĐÓNG trên {ref_dn:.6g}.")
        lp = build_plan("LONG", S, levels, price, bs, verdict == "LONG", trig, k15)

    if verdict in ("SHORT", "LONG"):
        chosen = sp if verdict == "SHORT" else lp
        if chosen is not None and chosen.rr2 < 1.0:
            reasons.append(
                f"Có reject đúng mép, NHƯNG stop phải nằm ngoài cả cụm HVN rộng "
                f"{(R if verdict == 'SHORT' else S).lo:.6g}–{(R if verdict == 'SHORT' else S).hi:.6g} "
                f"nên R:R chỉ {chosen.rr1:.2f}/{chosen.rr2:.2f}. Bậc kế tiếp không trả đủ cho "
                "quãng rủi ro → hạ về WAIT. Vào lệnh R:R dưới 1 là kiểu 'thắng ít, thua nhiều'.")
            verdict = "WAIT"
            chosen.active = False
            chosen.trigger = ("Chỉ vào khi giá lùi sát mép node hơn (stop ngắn lại) hoặc khi "
                              "xuất hiện bậc volume xa hơn cho TP2 — hiện R:R chưa đủ 1.0.")

    if verdict == "SHORT":
        plan, alt = sp, lp
    elif verdict == "LONG":
        plan, alt = lp, sp
    elif sp and lp:
        plan, alt = (sp, lp) if dist_up <= dist_dn else (lp, sp)
    else:
        plan, alt = (sp or lp), None

    return Decision(verdict, reasons, plan, alt, R, S, ref_up, ref_dn,
                    sig_up, sig_dn, acc_up, acc_dn, clusters)


# ============================================================
# Vi the dang mo cua user
# ============================================================

@dataclass
class Position:
    side: str
    entry: float
    sl: Optional[float]
    tp: Optional[float]
    lev: Optional[float]
    size: Optional[float]


def parse_position(s: str) -> Position:
    parts = [x.strip() for x in s.split(":")]
    if len(parts) < 2:
        raise ValueError("Định dạng: side:entry[:sl[:tp[:leverage[:size]]]] "
                         "ví dụ short:0.16208:0.162:0.154:10")
    side = parts[0].lower()
    if side not in ("short", "long"):
        raise ValueError("side phải là 'short' hoặc 'long'")

    def g(i):
        if i < len(parts) and parts[i] not in ("", "-", "none", "0"):
            return float(parts[i])
        return None
    return Position(side.upper(), float(parts[1]), g(2), g(3), g(4), g(5))


def containing_node(nodes: Sequence[Node], price: float) -> Optional[Node]:
    for n in sorted(nodes, key=lambda n: -n.share):
        if n.lo <= price <= n.hi:
            return n
    return None


# ============================================================
# Trinh bay
# ============================================================

DP = 5


def fp(x: Optional[float]) -> str:
    if x is None:
        return "n/a"
    return f"{x:.{DP}f}"


def fv(x: float) -> str:
    if x >= 1e9:
        return f"{x/1e9:.2f}B"
    if x >= 1e6:
        return f"{x/1e6:.2f}M"
    if x >= 1e3:
        return f"{x/1e3:.1f}K"
    return f"{x:.1f}"


def ict(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, ICT).strftime("%H:%M %d/%m/%Y")


def pct_from(price: float, ref: float) -> str:
    return f"{(price - ref) / ref * 100:+.2f}%"


def swing_points(candles: Sequence[Candle]) -> Tuple[int, int]:
    hi_i = max(range(len(candles)), key=lambda i: candles[i].h)
    lo_i = min(range(len(candles)), key=lambda i: candles[i].l)
    return hi_i, lo_i


def zoom_histogram(candles: Sequence[Candle], price: float, bs: float,
                   width: int = 34) -> List[str]:
    fine = bs / 2
    lo, hi = price * 0.92, price * 1.08
    hist: Dict[int, float] = defaultdict(float)
    for c in candles:
        if lo <= c.c <= hi and c.vol > 0:
            hist[bin_index(c.c, fine)] += c.vol
    if not hist:
        return ["(không có dữ liệu trong ±8%)"]
    mx = max(hist.values())
    tot = sum(hist.values())
    lines = []
    for i in range(max(hist), min(hist) - 1, -1):
        v = hist.get(i, 0.0)
        bar = "█" * int(round(v / mx * width))
        mark = "  <== giá" if bin_index(price, fine) == i else ""
        lines.append(f"{bin_center(i, fine):.{DP}f} |{bar:<{width}}| "
                     f"{v/tot*100:5.2f}%{mark}")
    return lines


def render(m: Market, profiles: Dict[str, Profile], levels: List[Level],
           dec: Decision, price: float, bs: float, k15: List[Candle],
           risk: Optional[float], account: Optional[float],
           pos: Optional[Position], now_ms: int) -> str:
    o: List[str] = []
    a = o.append
    sym = m.symbol.upper()

    a(f"📊 VOLUME PROFILE — {sym} Perp")
    a(f"Thời gian: {ict(now_ms)} ICT")
    src_txt = "Binance USDT-M Futures (fapi)" if m.source == "binance" else f"OKX Swap ({m.inst}) — FALLBACK"
    a(f"Nguồn: {src_txt}")
    a(f"Khung dữ liệu: 15m — {len(k15)} nến, từ {ict(k15[0].ts)} đến {ict(k15[-1].ts)} ICT "
      f"({(k15[-1].ts - k15[0].ts)/MS_D:.1f} ngày)")
    a(f"Giá last: {fp(m.last)} | mark: {fp(m.mark)} | bin size profile: {bs:g}")
    fr = f"{m.funding*100:+.4f}%" if m.funding is not None else "n/a"
    ft = ict(m.funding_time) if m.funding_time else "n/a"
    oi = f"{fv(m.oi_base)} {sym[:-4] if sym.endswith('USDT') else ''}" if m.oi_base else "n/a"
    if m.oi_usd:
        oi += f" (~${fv(m.oi_usd)})"
    a(f"Funding gần nhất/hiện hành: {fr} | mốc funding: {ft} ICT | Open Interest: {oi}")
    for n in m.notes:
        a(f"> Ghi chú nguồn: {n}")
    for w in m.warns:
        a(f"> ⚠️ {w}")
    a("")

    # --- TONG QUAN ---
    a("--- TỔNG QUAN ---")
    a("")
    a("| Cửa sổ | Nến | Tổng vol | POC (close) | %vol tại POC | POC (range) | VA 70% | Delta nến | Hình dạng |")
    a("|---|---:|---:|---:|---:|---:|---|---:|---|")
    for name in ("15D", "7D", "48H", "24H", "12H", "6H"):
        p = profiles.get(name)
        if not p or p.total <= 0:
            a(f"| {name} | 0 | — | — | — | — | — | — | thiếu dữ liệu |")
            continue
        a(f"| {name} | {p.n_candles} | {fv(p.total)} | {fp(p.poc)} | {p.poc_share*100:.2f}% | "
          f"{fp(p.poc_range)} | {fp(p.val)} – {fp(p.vah)} | "
          f"{p.delta['delta_pct']:+.1f}% | {p.shape} |")
    a("")
    for wn in ("15D", "7D", "24H"):
        pw = profiles.get(wn)
        if pw and pw.total > 0 and pw.poc_range is not None \
                and abs(pw.poc_range - pw.poc) > bs * 2:
            a(f"> ⚠️ Đối chiếu {wn}: POC theo close ({fp(pw.poc)}) lệch POC theo range "
              f"({fp(pw.poc_range)}) hơn 2 bin. Nghĩa là POC close đang bị vài cây nến khối "
              f"lượng lớn kéo lệch — coi cả vùng {fp(min(pw.poc, pw.poc_range))}–"
              f"{fp(max(pw.poc, pw.poc_range))} là nhà, đừng bám đúng một con số.")
    a("")

    # --- TOP HVN ---
    a("--- TOP HVN ---")
    a("")
    for wname in ("7D", "24H"):
        p = profiles.get(wname)
        if not p or not p.hvns:
            a(f"**{wname}**: thiếu dữ liệu / không đủ node đạt ngưỡng 1.2%.")
            a("")
            continue
        a(f"**{wname}** (ngưỡng share ≥ 1.2%, biên node = nới từ đỉnh khi volume còn giảm dần và còn ≥ 50% đỉnh):")
        a("")
        a("| # | Giá đỉnh node | Biên node (lo–hi) | %vol | So với giá |")
        a("|---:|---:|---|---:|---:|")
        for i, n in enumerate(p.hvns[:12], 1):
            a(f"| {i} | {fp(n.price)} | {fp(n.lo)} – {fp(n.hi)} | {n.share*100:.2f}% | "
              f"{pct_from(n.price, price)} |")
        a("")

    # --- VOLUME THEO VUNG ---
    a("--- VOLUME THEO VÙNG ---")
    a("")
    pz = profiles.get("7D") or profiles.get("15D")
    if pz and pz.total > 0:
        a(f"Phân bổ volume 7D quanh giá {fp(price)}:")
        a("")
        a("| Vùng | Khoảng giá | %vol 7D | Mật độ (%vol trên mỗi 1% giá) | Ý nghĩa |")
        a("|---|---|---:|---:|---|")
        for label, lo, hi, share in zone_volumes(pz, price):
            width = max((hi - lo) / price * 100, 1e-9)
            dens = share * 100 / width
            if dens >= 9:
                mean = "nhà volume — giá dính, khó xuyên nhanh"
            elif dens >= 5:
                mean = "có người giữ — cản/đỡ thật"
            elif dens >= 2:
                mean = "mỏng — giá đi nhanh qua"
            else:
                mean = "gần như trống — trượt tự do, không đặt TP ở đây"
            a(f"| {label} | {fp(lo)} – {fp(hi)} | {share*100:.2f}% | {dens:.1f} | {mean} |")
        a("")
        a("> Mật độ = %volume chia cho độ rộng vùng (tính theo % giá). So sánh mật độ mới đúng, "
          "so sánh %volume thô giữa các vùng rộng hẹp khác nhau là so sai.")
        a("")
        a("Histogram zoom ±8% quanh giá (7D, bin mịn = 1/2 bin chuẩn):")
        a("```")
        for line in zoom_histogram(
                slice_window(k15, 7 * 24, now_ms), price, bs):
            a(line)
        a("```")
        a("")

    # --- LVN / PATH ---
    a("--- LVN / PATH ---")
    a("")
    plv = profiles.get("7D") or profiles.get("15D")
    if plv and plv.lvns:
        a("Khe LVN 7D (share ≤ 0.8%, nằm trong range đã trade) — giá đi nhanh qua đây, "
          "không phải chỗ để giá đứng lại. Ưu tiên 8 khe gần giá nhất:")
        a("")
        near = sorted(plv.lvns, key=lambda n: abs(n.price - price))[:8]
        for n in sorted(near, key=lambda n: -n.price):
            tag = " — khe RỖNG, gần như không có giao dịch nào đóng ở đây" if n.share < 0.0005 else ""
            a(f"- {fp(n.lo)} – {fp(n.hi)} (đỉnh khe {fp(n.price)}, {n.share*100:.2f}%) "
              f"— {pct_from(n.price, price)} so với giá{tag}")
        a("")
    else:
        a("Không tìm thấy LVN đạt ngưỡng trong range 7D.")
        a("")

    min_gap = max(0.35, bs / price * 100 * 2)
    down = path_steps(levels, price, "down", min_gap, 4)
    up = path_steps(levels, price, "up", min_gap, 4)
    a("**Path xuống — giá phải xuyên từng bậc, cấm nhảy cóc:**")
    if down:
        prev = price
        for i, l in enumerate(down, 1):
            a(f"{i}. {fp(l.price)} ({l.kind}) — {l.label} | {pct_from(l.price, price)} từ giá "
              f"| cách bậc trước {abs(l.price-prev)/prev*100:.2f}%")
            prev = l.price
    else:
        a("(không đủ mức volume phía dưới)")
    a("")
    a("**Path lên:**")
    if up:
        prev = price
        for i, l in enumerate(up, 1):
            a(f"{i}. {fp(l.price)} ({l.kind}) — {l.label} | {pct_from(l.price, price)} từ giá "
              f"| cách bậc trước {abs(l.price-prev)/prev*100:.2f}%")
            prev = l.price
    else:
        a("(không đủ mức volume phía trên)")
    a("")
    if len(down) >= 2:
        a(f"> Ví dụ chống nhảy cóc: muốn về {fp(down[-1].price)} thì trước đó phải mất "
          + " rồi ".join(fp(l.price) for l in down[:-1])
          + ". Đặt target vượt bậc là bỏ qua người mua đang đứng ở các bậc trên.")
        a("")

    # --- DELTA ---
    a("--- DELTA ---")
    a("")
    a("⚠️ Delta ở đây là **proxy**: volume nến close>open trừ volume nến close<open "
      + ("(cộng thêm taker buy/sell thật của Binance)." if any("taker_delta" in (p.delta or {}) for p in profiles.values())
         else "(nguồn hiện tại không có taker buy/sell → chỉ có proxy nến xanh/đỏ).")
      + " Đây KHÔNG phải bid/ask delta thật.")
    a("")
    a("| Phạm vi | Vol xanh | Vol đỏ | Delta | Delta % | Taker delta |")
    a("|---|---:|---:|---:|---:|---:|")
    for name in ("15D", "48H", "24H", "6H"):
        p = profiles.get(name)
        if not p or not p.delta:
            continue
        d = p.delta
        td = (f"{d['taker_delta']:+,.0f} ({d['taker_delta_pct']:+.1f}%)"
              if "taker_delta" in d else "n/a")
        a(f"| {name} | {fv(d['up'])} | {fv(d['down'])} | {d['delta']:+,.0f} | "
          f"{d['delta_pct']:+.1f}% | {td} |")
    w7 = slice_window(k15, 7 * 24, now_ms) or k15
    hi_i, lo_i = swing_points(w7)
    after_hi = w7[hi_i:]
    after_lo = w7[lo_i:]
    dh, dl = delta_stats(after_hi), delta_stats(after_lo)
    def _td(d):
        return f"{d['taker_delta']:+,.0f}" if "taker_delta" in d else "n/a"

    a(f"| Sau swing high {fp(w7[hi_i].h)} ({ict(w7[hi_i].ts)}) | {fv(dh['up'])} | "
      f"{fv(dh['down'])} | {dh['delta']:+,.0f} | {dh['delta_pct']:+.1f}% | {_td(dh)} |")
    a(f"| Sau swing low {fp(w7[lo_i].l)} ({ict(w7[lo_i].ts)}) | {fv(dl['up'])} | "
      f"{fv(dl['down'])} | {dl['delta']:+,.0f} | {dl['delta_pct']:+.1f}% | {_td(dl)} |")
    a("")
    if m.depth and m.depth.get("bids") and m.depth.get("asks"):
        bidq = sum(q for _, q in m.depth["bids"])
        askq = sum(q for _, q in m.depth["asks"])
        tot = bidq + askq
        imb = (bidq - askq) / tot * 100 if tot else 0
        big_ask = max(m.depth["asks"], key=lambda t: t[1])
        big_bid = max(m.depth["bids"], key=lambda t: t[1])
        a(f"**Order book (20 mức):** bid {fv(bidq)} / ask {fv(askq)} → lệch {imb:+.1f}% "
          f"về phía {'mua' if imb > 0 else 'bán'}. "
          f"Cụm ask lớn nhất {fp(big_ask[0])} ({fv(big_ask[1])}), "
          f"cụm bid lớn nhất {fp(big_bid[0])} ({fv(big_bid[1])}).")
        a("> Đây chỉ là mô tả imbalance tại thời điểm chụp. Order book rút/đặt lại trong vài giây — "
          "KHÔNG coi các cụm này là kháng cự/hỗ trợ cứng.")
        a("")

    # --- BAN DO S/R ---
    a("--- BẢN ĐỒ S/R ---")
    a("")
    edge = max(bs * 0.5, price * 0.0015)
    kinds = ("HVN", "POC", "VAH", "VAL")
    res = [l for l in levels if l.price > price + edge and l.kind in kinds]
    sup = [l for l in levels if l.price < price - edge and l.kind in kinds]
    res.sort(key=lambda l: l.price)
    sup.sort(key=lambda l: l.price, reverse=True)
    a("**Kháng cự (chỉ từ volume):**")
    for i, l in enumerate(res[:3], 1):
        a(f"- Kháng cự {i}: {fp(l.price)} (vùng {fp(l.lo)}–{fp(l.hi)}) — {l.label} "
          f"| {pct_from(l.price, price)}")
    if not res:
        a("- Không có mức volume nào phía trên trong dữ liệu — giá đang ở đỉnh range đã trade.")
    a("")
    a("**Hỗ trợ (chỉ từ volume):**")
    for i, l in enumerate(sup[:3], 1):
        a(f"- Hỗ trợ {i}: {fp(l.price)} (vùng {fp(l.lo)}–{fp(l.hi)}) — {l.label} "
          f"| {pct_from(l.price, price)}")
    if not sup:
        a("- Không có mức volume nào phía dưới trong dữ liệu — dưới giá là vùng trống.")
    a("")
    p7 = profiles.get("7D") or profiles.get("15D")
    p24 = profiles.get("24H")
    if p7 and p24 and p7.total > 0 and p24.total > 0:
        long_poc, short_poc = p7.poc, p24.poc
        if price > max(long_poc, short_poc):
            where = (f"TRÊN cả hai nhà (POC 7D {fp(long_poc)}, POC 24H {fp(short_poc)}) — "
                     "phe mua đang giữ thế, nhưng mọi nhịp giảm sẽ bị hút về hai mức này.")
        elif price < min(long_poc, short_poc):
            where = (f"DƯỚI cả hai nhà (POC 7D {fp(long_poc)}, POC 24H {fp(short_poc)}) — "
                     "phe bán đang giữ thế, mọi nhịp hồi là hồi về tường.")
        else:
            where = (f"GIỮA hai nhà: POC 7D {fp(long_poc)}, POC 24H {fp(short_poc)} — "
                     "vùng kéo co, xác suất bị quét hai đầu cao nhất.")
        a(f"**Giá {fp(price)} đang đứng:** {where}")
        a("")
    a("> MA và số tròn (nếu có) chỉ là ghi chú phụ, không dùng làm S/R chính trong hệ này.")
    a("")

    # --- QUYET DINH ---
    a("--- QUYẾT ĐỊNH ---")
    a("")
    a(f"## {dec.verdict}")
    a("")
    for r in dec.reasons:
        a(f"- {r}")
    a(f"- Tín hiệu reject tại tường trên: {dec.sig_up.detail}.")
    a(f"- Tín hiệu reject tại sàn dưới: {dec.sig_down.detail}.")
    a("")

    # --- 4 SO ---
    a("--- 4 SỐ ---")
    a("")
    plan = dec.plan
    if plan is None:
        a("Không dựng được kế hoạch: thiếu node volume ở ít nhất một phía. Không bịa số.")
    else:
        state = "✅ VÀO ĐƯỢC NGAY" if plan.active else "⏳ CHƯA KÍCH HOẠT — lệnh chờ"
        a(f"**Kịch bản chính: {plan.side} — {state}**")
        a(f"Điều kiện kích hoạt: {plan.trigger}")
        a("")
        a("```")
        a(f"Entry              : {fp(plan.entry)}   (vùng {fp(plan.entry_lo)}–{fp(plan.entry_hi)})")
        a(f"Stop (thesis chết) : {fp(plan.stop)}")
        a(f"TP1 (gỡ 40–50%)    : {fp(plan.tp1)}")
        a(f"TP2 (đóng phần còn): {fp(plan.tp2)}")
        a("```")
        a("")
        a(f"- Entry: {plan.entry_note}. Chỉ vào ở MÉP nhà, không vào giữa nhà.")
        a(f"- Stop: {plan.stop_note}. Stop nằm NGOÀI cụm HVN — nơi luận điểm thật sự chết, "
          f"cách entry {abs(plan.stop-plan.entry)/plan.entry*100:.2f}%.")
        a(f"- TP1: {plan.tp1_note} — bậc đầu tiên trước mặt lệnh ({pct_from(plan.tp1, plan.entry)} từ entry).")
        a(f"- TP2: {plan.tp2_note} ({pct_from(plan.tp2, plan.entry)} từ entry).")
        seq = path_steps(levels, plan.entry, "down" if plan.side == "SHORT" else "up",
                         max(0.35, bs / price * 100 * 2), 6)
        upto = []
        for l in seq:
            upto.append(l)
            if (plan.side == "SHORT" and l.price <= plan.tp2) or \
               (plan.side == "LONG" and l.price >= plan.tp2):
                break
        if upto:
            a("- Path đầy đủ từ entry tới TP2 (không bậc nào bị bỏ qua): "
              + f"{fp(plan.entry)} → "
              + " → ".join(f"{fp(l.price)} ({l.kind})" for l in upto))
        a(f"- R:R = **{plan.rr1:.2f}** đến TP1, **{plan.rr2:.2f}** đến TP2.")
        a(f"- Invalidation hành động: {plan.invalidation}")
        for w in plan.warnings:
            a(f"- ⚠️ {w}")
        a("")
        stop_pct = abs(plan.stop - plan.entry) / plan.entry * 100
        risk_usdt = risk if risk is not None else (account * 0.01 if account else None)
        a("**Size (gợi ý, không bắt buộc theo):**")
        if risk_usdt:
            qty = risk_usdt / abs(plan.entry - plan.stop)
            notional = qty * plan.entry
            a(f"- risk = {risk_usdt:.2f} USDT → qty = {risk_usdt:.2f} / |{fp(plan.entry)} − {fp(plan.stop)}| "
              f"= **{qty:,.0f} {sym[:-4] if sym.endswith('USDT') else 'coin'}** (notional ≈ {notional:,.0f} USDT)")
        else:
            a("- Chưa khai --risk hoặc --account → không tính qty. Công thức: "
              f"qty = risk_usdt / |entry − stop| = risk_usdt / {abs(plan.entry-plan.stop):.6g}. "
              f"Với mỗi 100 USDT risk → {100/abs(plan.entry-plan.stop):,.0f} coin.")
        safe_lev = min(5.0, 8.0 / stop_pct) if stop_pct > 0 else 5.0
        a(f"- Stop cách entry {stop_pct:.2f}%. Trần đòn bẩy hệ này gợi ý là **5x**; "
          f"để mức lỗ khi chạm stop không quá 8% vốn vị thế thì đòn bẩy tối đa là "
          f"**{safe_lev:.1f}x**.")
        for lev in (2, 3, 5, 10):
            flag = " ⚠️ vượt ngưỡng 8%" if stop_pct * lev > 8 else ""
            a(f"  - {lev}x → chạm stop mất {stop_pct*lev:.2f}% vốn vị thế{flag}")
        a("")
    if dec.alt_plan:
        alt = dec.alt_plan
        a(f"**Kịch bản đối ứng ({alt.side}) — chỉ dùng khi kích hoạt, không vào cùng lúc:**")
        a(f"- Kích hoạt: {alt.trigger}")
        a(f"- Entry {fp(alt.entry)} | Stop {fp(alt.stop)} | TP1 {fp(alt.tp1)} | TP2 {fp(alt.tp2)} "
          f"| R:R {alt.rr1:.2f}/{alt.rr2:.2f}")
        a("")

    # --- NEU DANG CO LENH ---
    a("--- NẾU ĐANG CÓ LỆNH ---")
    a("")
    if pos is None:
        a("Chưa dán vị thế. Dán bằng: "
          "`--position side:entry:sl:tp:leverage[:size]` "
          "ví dụ `--position short:0.16208:0.162:0.154:10`.")
        a("")
    else:
        cl = dec.clusters
        last_close = k15[-1].c
        pnl_pct = ((pos.entry - price) / pos.entry * 100) if pos.side == "SHORT" \
            else ((price - pos.entry) / pos.entry * 100)
        a(f"**Vị thế: {pos.side} entry {fp(pos.entry)}"
          + (f", SL {fp(pos.sl)}" if pos.sl else ", SL: KHÔNG CÓ")
          + (f", TP {fp(pos.tp)}" if pos.tp else ", TP: chưa đặt")
          + (f", đòn bẩy {pos.lev:g}x" if pos.lev else "") + "**")
        a(f"- Giá hiện tại {fp(price)} → lãi/lỗ theo giá: **{pnl_pct:+.2f}%**"
          + (f" (≈ {pnl_pct*pos.lev:+.2f}% trên vốn vị thế ở {pos.lev:g}x)" if pos.lev else ""))
        a(f"- Nến 15m đã đóng gần nhất: close {fp(last_close)} "
          f"({ict(k15[-1].ts)} ICT) — mọi điều kiện dưới đây tính trên nến đã đóng, "
          "không tính trên giá đang nhảy.")

        en_c = cluster_at(cl, pos.entry)
        a(f"- Entry {fp(pos.entry)}: "
          + (f"nằm TRONG cụm HVN {fp(en_c.lo)}–{fp(en_c.hi)} (đỉnh {fp(en_c.price)}) "
             "— vào giữa nhà, đây là kiểu vào lệnh dễ bị dập hai chiều"
             if en_c else "nằm NGOÀI mọi cụm HVN"))

        if pos.sl is None:
            out_edge = (dec.node_up.hi + bs) if (pos.side == "SHORT" and dec.node_up) \
                else ((dec.node_down.lo - bs) if dec.node_down else None)
            a("- ❌ **KHÔNG CÓ STOP.** Đây là cách cháy tài khoản, không phải phong cách giao dịch. "
              + (f"Đặt ngay tại {fp(out_edge)} (ngoài biên cụm HVN gần nhất)."
                 if out_edge else "Thiếu node để tính — không bịa số, nhưng vẫn phải có stop."))
        else:
            sl_c = cluster_at(cl, pos.sl)
            if sl_c:
                fix = sl_c.hi + bs if pos.side == "SHORT" else sl_c.lo - bs
                a(f"- ❌ SL {fp(pos.sl)} **NẰM TRONG cụm HVN {fp(sl_c.lo)}–{fp(sl_c.hi)}** — "
                  "đây là vùng đông người giao dịch nhất, tức SL đang nằm trong nhiễu và sẽ bị "
                  "quét trước khi luận điểm thật sự sai. "
                  f"Đẩy ra ngoài cụm: **{fp(fix)}**"
                  + (f" (rủi ro khi đó là {abs(fix-pos.entry)/pos.entry*100:.2f}% "
                     "tính từ entry — nếu quá lớn thì giảm size, đừng thu ngắn stop).")
                  )
            else:
                a(f"- ✅ SL {fp(pos.sl)} nằm NGOÀI mọi cụm HVN — đúng chỗ. "
                  f"Cách giá hiện tại {abs(pos.sl-price)/price*100:.2f}%.")
            profit_side = (pos.sl < pos.entry) if pos.side == "SHORT" else (pos.sl > pos.entry)
            sl_risk = abs(pos.entry - pos.sl) / pos.entry * 100
            if profit_side:
                a(f"- ⚠️ SL {fp(pos.sl)} nằm ở phía CÓ LỜI so với entry {fp(pos.entry)}: đây là "
                  f"stop khoá lời/BE, không phải stop luận điểm. Nó chỉ khoá {sl_risk:.2f}% — "
                  "khoảng cách này nằm gọn trong biên độ nhiễu của một nến 15m, nên gần như "
                  "chắc chắn bị quét trước khi luận điểm được kiểm chứng. Đây đúng là kiểu "
                  "'thắng ít' đã nói ở phần CẤM.")
            a(f"- Khoảng cách SL–entry: {sl_risk:.2f}%"
              + (f" → ở {pos.lev:g}x là {sl_risk*pos.lev:.2f}% vốn vị thế"
                 + (" ⚠️ vượt ngưỡng 8%: giảm đòn bẩy hoặc giảm size."
                    if sl_risk*pos.lev > 8 else "")
                 if pos.lev else ""))

        if pos.tp:
            tp_c = cluster_at(cl, pos.tp)
            a(f"- TP {fp(pos.tp)}: "
              + (f"nằm trong cụm HVN {fp(tp_c.lo)}–{fp(tp_c.hi)} — đúng nguyên tắc: "
                 "chốt ở nơi có người đối ứng."
                 if tp_c else
                 "nằm ở vùng MỎNG, không có node đỡ/cản. Lệnh chờ ở đây dễ không khớp đủ — "
                 "cân nhắc kéo về cụm HVN gần nhất trước mặt."))
            steps = path_steps(levels, price, "down" if pos.side == "SHORT" else "up", min_gap, 4)
            if pos.side == "SHORT":
                between = [l for l in steps if pos.tp < l.price < price]
            else:
                between = [l for l in steps if price < l.price < pos.tp]
            if between:
                a("- Bậc phải xuyên trước khi tới TP: "
                  + " → ".join(f"{fp(l.price)} ({l.kind})" for l in between)
                  + ". Giá không nhảy cóc — mỗi bậc là một lần có thể bị đẩy ngược.")

        tp1_ref = plan.tp1 if (plan and plan.side == pos.side) else None
        left_node = cluster_at(cl, last_close) is None or cluster_at(cl, last_close) is not en_c
        if tp1_ref is None:
            be_txt = ("Chưa có TP1 cùng chiều từ profile để làm mốc → **chưa** đủ điều kiện, "
                      "giữ nguyên SL.")
        else:
            passed = (last_close < tp1_ref) if pos.side == "SHORT" else (last_close > tp1_ref)
            if passed and left_node:
                be_txt = (f"✅ Đủ: nến 15m đã đóng {fp(last_close)} qua TP1 {fp(tp1_ref)} và đã "
                          "rời khỏi node. Được dời SL về entry.")
            elif passed and not left_node:
                be_txt = (f"❌ CHƯA: đã đóng qua TP1 {fp(tp1_ref)} nhưng giá vẫn nằm trong thân "
                          "node — kéo BE lúc này là tự cắt lệnh trong nhiễu.")
            else:
                be_txt = (f"❌ CHƯA: nến 15m đóng {fp(last_close)}, chưa qua TP1 {fp(tp1_ref)}. "
                          "Giữ nguyên SL đã đặt, KHÔNG kéo vào giữa node.")
        a(f"- **Dời SL về entry (BE)?** Điều kiện duy nhất: nến 15m ĐÓNG qua TP1 VÀ đã rời hẳn "
          f"khỏi node. Hiện tại: {be_txt}")
        a("")

    # --- CAM ---
    a("--- CẤM ---")
    a("")
    a("- Không target nhảy cóc: mọi TP trong báo cáo này đều là bậc kế tiếp trên path, "
      "không phải mức xa đẹp mắt.")
    a("- Không gọi order wall là kháng cự cứng: order book chỉ là ảnh chụp, rút được trong 1 giây.")
    a("- Không gồng lỗ: giá đóng 15m qua stop = luận điểm chết, đóng lệnh, không chờ 'nó sẽ về'.")
    a("- Không kéo BE khi giá còn trong HVN: trong node giá dao động hai chiều, kéo BE = tự cắt lệnh.")
    a("- Không vào lại ngay sau khi bị quét, không đảo chiều lệnh vì tức. "
      "Sau 1 lệnh thua, chỉ vào lại khi có reject MỚI tại mép node.")
    a("")

    # --- KET LUAN ---
    a("--- KẾT LUẬN ---")
    a("")
    concl: List[str] = []
    _lp = profiles.get("7D") or profiles.get("15D")
    _long_poc = _lp.poc if _lp and _lp.total > 0 else price
    _here = cluster_at(dec.clusters, price)
    if _here is not None:
        concl.append(f"Giá {fp(price)} đang nằm TRONG cụm HVN {fp(_here.lo)}–{fp(_here.hi)} "
                     f"(đỉnh {fp(_here.price)}); nhà dài hạn là POC {fp(_long_poc)}.")
    elif dec.node_up and dec.node_down:
        concl.append(f"Giá {fp(price)} nằm trong khoảng trống giữa sàn "
                     f"{fp(dec.node_down.lo)}–{fp(dec.node_down.hi)} và tường "
                     f"{fp(dec.node_up.lo)}–{fp(dec.node_up.hi)}; "
                     f"nhà dài hạn là POC {fp(_long_poc)}.")
    if dec.verdict == "WAIT":
        concl.append("Chưa có mép + reject nên không có lệnh: đứng ngoài là vị thế đúng lúc này, "
                     "kế hoạch ở trên là lệnh chờ có điều kiện rõ ràng.")
    else:
        concl.append(f"Đã đủ điều kiện {dec.verdict} tại mép node với stop nằm ngoài cụm HVN, "
                     "rủi ro được định nghĩa trước khi vào.")
    concl.append("Bốn con số ở mục 4 SỐ là toàn bộ lệnh: vào, chết, gỡ, đóng — "
                 "không thêm cảm tính vào giữa.")
    for c in concl[:3]:
        a(f"- {c}")
    a("")
    a("**Không phải khuyến nghị đầu tư.**")
    return "\n".join(o)


# ============================================================
# main
# ============================================================

WINDOWS: List[Tuple[str, float]] = [
    ("15D", 15 * 24), ("7D", 7 * 24), ("48H", 48), ("24H", 24), ("12H", 12), ("6H", 6),
]


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        prog="vp_desk.py",
        description="VP-Desk — Volume Profile / S-R / kế hoạch lệnh cho USDT-M Futures.")
    ap.add_argument("--symbol", default="ENAUSDT", help="mặc định ENAUSDT")
    ap.add_argument("--source", choices=("auto", "binance", "okx"), default="auto",
                    help="auto = thử Binance, 451/403 thì rơi sang OKX")
    ap.add_argument("--limit", type=int, default=1500, help="số nến 15m (tối đa 1500)")
    ap.add_argument("--risk", type=float, default=None, help="risk mỗi lệnh, USDT")
    ap.add_argument("--account", type=float, default=None,
                    help="vốn tài khoản USDT — nếu không khai --risk thì lấy 1%%")
    ap.add_argument("--position", default=None,
                    help="vị thế đang mở: side:entry:sl:tp:leverage[:size] "
                         "vd short:0.16208:0.162:0.154:10")
    ap.add_argument("--json", action="store_true", help="xuất thêm JSON tóm tắt ra stderr")
    args = ap.parse_args(argv)

    symbol = args.symbol.upper()
    pos: Optional[Position] = None
    if args.position:
        try:
            pos = parse_position(args.position)
        except ValueError as e:
            sys.stderr.write(f"[VP-Desk] --position sai định dạng: {e}\n")
            return 2

    try:
        m = fetch_market(symbol, args.source, min(args.limit, 1500))
    except GeoBlocked as e:
        sys.stderr.write(
            f"[VP-Desk] LỖI: {e}\n"
            "[VP-Desk] data-api.binance.vision KHÔNG phục vụ futures nên không thay thế được.\n"
            "[VP-Desk] Chạy lại với: --source okx (instId sẽ là "
            f"{to_okx_inst(symbol)}, bar=15m)\n")
        return 3
    except DataError as e:
        sys.stderr.write(f"[VP-Desk] LỖI dữ liệu: {e}\n")
        return 4

    k15 = m.k15
    if len(k15) < 96:
        sys.stderr.write(
            f"[VP-Desk] Chỉ có {len(k15)} nến 15m (<24h). Dữ liệu quá mỏng để dựng "
            "volume profile đáng tin. Không bịa thêm.\n")
        return 5

    price = m.last or m.mark or k15[-1].c
    now_ms = max(k15[-1].ts + 15 * MS_MIN, int(time.time() * 1000))
    lo_all = min(c.l for c in k15)
    hi_all = max(c.h for c in k15)
    bs, bin_note = choose_bin(price, lo_all, hi_all)
    if bin_note:
        m.notes.append(bin_note)
    global DP
    DP = decimals_for(bs)

    profiles: Dict[str, Profile] = {}
    for name, hours in WINDOWS:
        w = slice_window(k15, hours, now_ms)
        if name == "15D" and len(w) < 4:
            w = list(k15)
        if len(w) < 4:
            profiles[name] = Profile(name, bs, {}, 0.0, len(w), 0, 0)
            continue
        profiles[name] = build_profile(name, w, bs)

    have = [n for n, p in profiles.items() if p.total > 0]
    if not have:
        sys.stderr.write("[VP-Desk] Không dựng được profile nào — thiếu volume.\n")
        return 6
    span_days = (k15[-1].ts - k15[0].ts) / MS_D
    if span_days < 14.0:
        m.warns.append(
            f"Dữ liệu 15m chỉ trải {span_days:.1f} ngày → cửa sổ 15D thực chất là "
            f"{span_days:.1f}D (toàn bộ nến lấy được), không phải 15 ngày đủ.")

    levels = build_levels(profiles, bs)
    dec = decide(price, k15, profiles, levels, bs)

    out = render(m, profiles, levels, dec, price, bs, k15,
                 args.risk, args.account, pos, now_ms)
    print(out)

    if args.json:
        p7 = profiles.get("7D")
        summary = {
            "symbol": symbol, "source": m.source, "price": price, "bin": bs,
            "verdict": dec.verdict,
            "poc_7d": p7.poc if p7 and p7.total else None,
            "plan": None if not dec.plan else {
                "side": dec.plan.side, "active": dec.plan.active,
                "entry": dec.plan.entry, "stop": dec.plan.stop,
                "tp1": dec.plan.tp1, "tp2": dec.plan.tp2,
                "rr1": round(dec.plan.rr1, 2), "rr2": round(dec.plan.rr2, 2),
            },
        }
        sys.stderr.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
