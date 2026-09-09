import { permanentRedirect } from 'next/navigation';

// Legacy route. /maintenance is retired — system vitals now live at /health
// (BUILD-BRIEF §11 / health.md §11). Permanent redirect keeps old links alive.
export default function MaintenanceRedirect(): never {
  permanentRedirect('/health');
}
