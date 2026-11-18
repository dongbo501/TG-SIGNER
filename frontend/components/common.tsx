"use client";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
} from "react";
import { Loader2, Inbox, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Button, ButtonProps } from "./ui/button";
import { toast } from "sonner";
export function Field({
  label,
  hint,
  children,
  className,
  hintAriaHidden,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  hintAriaHidden?: boolean;
}) {
  const generatedId = useId();
  const control =
    isValidElement<any>(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type)
      ? children
      : null;
  const controlId = control?.props.id || generatedId;
  const hintId = `${controlId}-hint`;
  const labelledChildren = control
    ? cloneElement<any>(control, {
        id: controlId,
        name: control.props.name ?? controlId,
        "aria-describedby":
          [
            control.props["aria-describedby"],
            hint && !hintAriaHidden ? hintId : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      })
    : children;
  return (
    <div
      className={cn(
        "grid min-w-0 content-start items-start gap-2 text-sm font-medium text-ink",
        className,
      )}
    >
      {control ? (
        <label htmlFor={controlId}>{label}</label>
      ) : (
        <span>{label}</span>
      )}
      {labelledChildren}
      {hint && (
        <span
          id={hintId}
          aria-hidden={hintAriaHidden}
          className="text-xs font-normal leading-5 text-muted"
        >
          {hint}
        </span>
      )}
    </div>
  );
}

export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="mb-1 rounded-2xl bg-success-soft p-4 text-primary">
        <Inbox size={26} />
      </div>
      <p className="font-semibold">{title}</p>
      <p className="max-w-sm text-sm leading-6 text-muted">{description}</p>
      {action}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  const map: Record<string, [string, string]> = {
    online: ["在线", "bg-success-soft text-success"],
    success: ["成功", "bg-success-soft text-success"],
    completed: ["已执行", "bg-info-soft text-info"],
    failed: ["失败", "bg-danger-soft text-danger"],
    invalid: ["需验证", "bg-warning-soft text-warning"],
    banned: ["已封禁", "bg-danger-soft text-danger"],
    running: ["运行中", "bg-info-soft text-info"],
    pending: ["待执行", "bg-surface-raised text-muted"],
    offline: ["未连接", "bg-surface-raised text-muted"],
    cancelled: ["已停止", "bg-surface-raised text-muted"],
    interrupted: ["已中断", "bg-warning-soft text-warning"],
  };
  const [label, color] = map[value] || [value, "bg-surface-raised text-muted"];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        color,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-current",
          value === "running" && "animate-pulse",
        )}
      />
      {label}
    </span>
  );
}
export function ActionButton({
  action,
  success,
  children,
  ...props
}: ButtonProps & { action: () => Promise<unknown>; success?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      {...props}
      disabled={busy || props.disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await action();
          if (success) toast.success(success);
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
export function DataTable<T>({
  data,
  columns,
  empty = "暂无记录",
  resetPageKey = "",
  caption = "数据列表",
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  empty?: string;
  resetPageKey?: string;
  caption?: string;
}) {
  const captionId = useId();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    // Polling replaces the data array; it must not reset the current page.
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  const pageCount = Math.max(1, table.getPageCount());
  const currentPage = Math.min(pagination.pageIndex + 1, pageCount);
  useEffect(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }, [resetPageKey]);
  useEffect(() => {
    // Deleting the last row on a page should show the nearest remaining page.
    setPagination((current) =>
      current.pageIndex < pageCount
        ? current
        : { ...current, pageIndex: pageCount - 1 },
    );
  }, [pageCount]);
  const visiblePages = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) => Math.max(1, Math.min(currentPage - 2, pageCount - 4)) + index,
  );
  const pageNumbers = [...new Set([1, ...visiblePages, pageCount])];
  return (
    <>
      <div
        className="table-scroll"
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
      >
        <table className="data-table">
          <caption id={captionId} className="sr-only">
            {caption}
          </caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    scope="col"
                    aria-sort={
                      header.column.getCanSort()
                        ? header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    key={header.id}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="sort-button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <span aria-hidden="true">
                          {header.column.getIsSorted() === "asc"
                            ? "↑"
                            : header.column.getIsSorted() === "desc"
                              ? "↓"
                              : "↕"}
                        </span>
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                className="border-b border-line last:border-0 hover:bg-surface-muted"
                key={row.id}
              >
                {row.getVisibleCells().map((cell, index) =>
                  index === 0 ? (
                    <th scope="row" key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </th>
                  ) : (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.length && (
        <Empty
          title={empty}
          description="添加账号并配置任务后，执行结果将显示在这里。"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
        <div className="flex flex-wrap items-center gap-3">
          <span role="status">
            共 {data.length} 条 · 显示{" "}
            {data.length ? (currentPage - 1) * pagination.pageSize + 1 : 0}–
            {Math.min(currentPage * pagination.pageSize, data.length)} 条 · 第{" "}
            {currentPage} / {pageCount} 页
          </span>
          <label className="flex items-center gap-2 whitespace-nowrap">
            每页
            <select
              aria-label="每页条数"
              className="!h-8 !w-auto !py-1 text-xs"
              value={pagination.pageSize}
              onChange={(event) =>
                setPagination({
                  pageIndex: 0,
                  pageSize: Number(event.target.value),
                })
              }
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav
          aria-label="表格分页"
          className="flex flex-wrap items-center gap-1"
        >
          <Button
            variant="outline"
            size="sm"
            aria-label="上一页"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft size={16} />
            上一页
          </Button>
          {pageNumbers.map((pageNumber, index) => (
            <span key={pageNumber} className="flex items-center gap-1">
              {index > 0 && pageNumber - pageNumbers[index - 1] > 1 && (
                <span aria-hidden="true" className="px-1">
                  …
                </span>
              )}
              <Button
                variant={currentPage === pageNumber ? "default" : "outline"}
                size="sm"
                className="min-w-8 !px-2"
                aria-label={`第 ${pageNumber} 页`}
                aria-current={currentPage === pageNumber ? "page" : undefined}
                onClick={() => table.setPageIndex(pageNumber - 1)}
              >
                {pageNumber}
              </Button>
            </span>
          ))}
          <Button
            variant="outline"
            size="sm"
            aria-label="下一页"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            下一页
            <ChevronRight size={16} />
          </Button>
        </nav>
      </div>
    </>
  );
}
