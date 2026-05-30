import { listTasks } from '@/lib/tasks';
import { TasksView } from '@/components/tasks/TasksView';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const tasks = await listTasks();
  return <TasksView tasks={tasks} />;
}
