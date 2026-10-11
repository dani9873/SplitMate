import { useAuth } from '@/features/auth';
import { NotFoundScreen } from '@/features/navigation';

export default function NotFound() {
  const { state } = useAuth();
  return <NotFoundScreen home={state.status === 'signedIn' ? '/' : '/welcome'} />;
}
