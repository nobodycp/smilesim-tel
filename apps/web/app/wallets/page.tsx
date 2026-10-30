import { redirect } from 'next/navigation';

export default function WalletsRedirect() {
  redirect('/users');
}
