import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listBackups, getBackupDownloadUrl, runBackupNow } from "@/lib/admin.functions";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, Database } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/backups")({ component: BackupsPage });

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

function BackupsPage() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !isAdmin) navigate({ to: "/" }); }, [loading, isAdmin, navigate]);

  const listFn = useServerFn(listBackups);
  const qc = useQueryClient();
  const { data: backups = [], isLoading } = useQuery({
    queryKey: ["backups"],
    queryFn: () => listFn({}),
    enabled: isAdmin,
  });

  const urlFn = useServerFn(getBackupDownloadUrl);
  const download = async (path: string) => {
    try {
      const { url } = await urlFn({ data: { path } });
      window.open(url, "_blank");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const runFn = useServerFn(runBackupNow);
  const run = useMutation({
    mutationFn: () => runFn({}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["backups"] }); toast.success("Backup created"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="size-6" />Daily Backups</h1>
          <p className="text-muted-foreground text-sm">Excel exports run automatically at 00:00 UTC. You can also run one on demand.</p>
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          <RefreshCw className={`size-4 mr-2 ${run.isPending ? "animate-spin" : ""}`} />Run backup now
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backup history</CardTitle>
          <CardDescription>{backups.length} most recent exports</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (<TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>)}
                {!isLoading && backups.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No backups yet. The first one will run at 00:00 UTC, or click "Run backup now".
                  </TableCell></TableRow>
                )}
                {backups.map((b) => {
                  const counts = (b.row_counts ?? {}) as Record<string, number>;
                  const total = Object.values(counts).reduce((s: number, n) => s + Number(n), 0);
                  return (
                    <TableRow key={b.id}>
                      <TableCell>{new Date(b.created_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{b.filename}</TableCell>
                      <TableCell>{total}</TableCell>
                      <TableCell>{fmtBytes(Number(b.file_size_bytes))}</TableCell>
                      <TableCell>
                        <Badge variant={b.status === "success" ? "secondary" : "destructive"}>{b.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {b.status === "success" && (
                          <Button size="sm" variant="outline" onClick={() => download(b.storage_path)}>
                            <Download className="size-4 mr-2" />Download
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
