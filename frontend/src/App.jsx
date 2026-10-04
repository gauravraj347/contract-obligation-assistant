import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout.jsx';
import { EmptyState } from './components/StatusViews.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { ContractPage } from './pages/ContractPage.jsx';
import { ContractsPage } from './pages/ContractsPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { NewContractPage } from './pages/NewContractPage.jsx';

export const routes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/contracts', element: <ContractsPage /> },
      { path: '/contracts/new', element: <NewContractPage /> },
      { path: '/contracts/:contractId', element: <ContractPage /> },
      { path: '*', element: <EmptyState title="Page not found" action={{ to: '/', label: 'Go to dashboard' }} /> },
    ],
  },
];

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Don't retry client errors (404, 400); retry transient failures once.
        retry: (count, error) => (error?.status >= 400 && error?.status < 500 ? false : count < 1),
        refetchOnWindowFocus: false,
      },
    },
  });
}

const router = createBrowserRouter(routes);
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
