import { InboxPageContent } from './inbox/inbox-page-content';
import { useInboxPageModel } from './inbox/use-inbox-page-model';

export default function Inbox() {
  const model = useInboxPageModel();
  return <InboxPageContent model={model} />;
}
