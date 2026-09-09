import type { Metadata } from 'next';
import { listTasks } from '@/lib/tasks';
import { loadCalendarWeek, loadCalendarToday } from '@/lib/calendar';
import { TasksPageClient } from '@/components/tasks/TasksPageClient';
import { parseViewParams } from '@/components/tasks/task-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tasks · Robin',
  description: 'Delivery board — outcomes, workstreams and leaves, keyboard-driven, honest about who touched what.',
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [tasks, week, today, sp] = await Promise.all([
    listTasks(),
    loadCalendarWeek(),
    loadCalendarToday(),
    searchParams,
  ]);
  const initial = parseViewParams(sp);
  return <TasksPageClient initialTasks={tasks} week={week} today={today} initial={initial} />;
}
