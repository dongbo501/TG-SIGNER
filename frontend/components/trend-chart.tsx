"use client";
import { memo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendPoint = {
  date: string;
  success: number;
  failed: number;
  completed: number;
};

function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div
      className="h-56 min-w-0"
      role="img"
      aria-label="最近七天任务执行趋势，完整数据见下方查看趋势数据"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ left: -25, right: 10, top: 5, bottom: 0 }}
        >
          <defs>
            <linearGradient id="successFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-primary)"
                stopOpacity={0.2}
              />
              <stop
                offset="100%"
                stopColor="var(--color-primary)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="4 5"
            vertical={false}
            stroke="var(--color-line)"
          />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => value.slice(5)}
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            axisLine={false}
            tickLine={false}
            dy={8}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, (max: number) => Math.max(4, max)]}
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="trend-tooltip">
                  <p>{label}</p>
                  {payload.map((item) => (
                    <p key={String(item.dataKey)}>
                      {item.name}：{item.value} 次
                    </p>
                  ))}
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            name="成功"
            dataKey="success"
            stroke="var(--color-primary)"
            strokeWidth={2.5}
            fill="url(#successFill)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            name="失败"
            dataKey="failed"
            stroke="var(--color-danger)"
            strokeDasharray="5 3"
            strokeWidth={2}
            fill="transparent"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            name="已执行 / 未验证"
            dataKey="completed"
            stroke="var(--color-info)"
            strokeDasharray="2 3"
            strokeWidth={2}
            fill="transparent"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export default memo(TrendChart);
