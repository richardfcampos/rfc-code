# State Management Reference

## Table of Contents

1. [State Management Decision](#state-management-decision)
2. [React Built-in State](#react-built-in-state)
3. [Server State (React Query / SWR)](#server-state)
4. [Zustand](#zustand)
5. [Redux Toolkit](#redux-toolkit)
6. [URL State](#url-state)
7. [Form State](#form-state)

---

## State Management Decision

### Decision Matrix

| State Type | Where It Lives | Recommended Tool |
|-----------|---------------|-----------------|
| **Local UI state** (toggle, modal open) | Component | `useState` / `useReducer` |
| **Shared UI state** (theme, sidebar) | Near root | React Context or Zustand |
| **Server/async data** (API responses) | Cache layer | React Query / SWR |
| **Complex client state** (cart, editor) | Global store | Zustand or Redux Toolkit |
| **Form state** (inputs, validation) | Form | React Hook Form |
| **URL state** (filters, pagination) | URL | `useSearchParams` / `nuqs` |

### Rules
- **Server state ≠ client state** — Don't store API data in Redux/Zustand. Use React Query.
- **Start local, lift when needed** — Begin with `useState`. Only lift state or go global when a real need arises.
- **URL is state** — Filters, pagination, tabs, search queries belong in the URL (shareable, bookmarkable).
- **Derive, don't sync** — If state B can be computed from state A, don't store B. Compute it.

---

## React Built-in State

### useState vs useReducer

| Use `useState` | Use `useReducer` |
|---------------|-----------------|
| Simple values (boolean, string, number) | Complex state objects |
| Independent state pieces | Related state that updates together |
| 1-2 state variables in a component | 3+ state variables that interact |
| Simple update logic | Complex update logic with many cases |

### useReducer Pattern
```tsx
type State = { items: Item[]; loading: boolean; error: string | null };
type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: Item[] }
  | { type: 'FETCH_ERROR'; payload: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START': return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS': return { ...state, loading: false, items: action.payload };
    case 'FETCH_ERROR': return { ...state, loading: false, error: action.payload };
  }
}
```

### React Context (Shared State)
```tsx
// Good for: Theme, locale, auth status, feature flags
// Bad for: Frequently updating state (causes all consumers to re-render)

const ThemeContext = createContext<{ theme: 'light' | 'dark'; toggle: () => void }>(null!);

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const toggle = useCallback(() => setTheme(t => t === 'light' ? 'dark' : 'light'), []);
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
```

**Context performance rule:** Split frequently-changing values into separate contexts. Don't put everything in one giant context.

---

## Server State

### React Query (TanStack Query) — Recommended

```tsx
// Basic query
function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => fetchUser(id),
    staleTime: 5 * 60 * 1000, // 5 minutes before refetch
  });
}

// Mutation with optimistic update
function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateUser,
    onMutate: async (newUser) => {
      await queryClient.cancelQueries({ queryKey: ['user', newUser.id] });
      const previous = queryClient.getQueryData(['user', newUser.id]);
      queryClient.setQueryData(['user', newUser.id], newUser); // Optimistic
      return { previous };
    },
    onError: (err, newUser, context) => {
      queryClient.setQueryData(['user', newUser.id], context?.previous); // Rollback
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user', variables.id] }); // Refetch
    },
  });
}

// Infinite scroll
function usePosts() {
  return useInfiniteQuery({
    queryKey: ['posts'],
    queryFn: ({ pageParam = 0 }) => fetchPosts({ offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
```

### Query Key Conventions
```tsx
['users']                    // All users
['users', { role: 'admin' }] // Filtered users
['users', userId]            // Single user
['users', userId, 'posts']   // User's posts
```

---

## Zustand

### When to Use
- Shared client state that doesn't come from the server
- Simpler than Redux, no boilerplate
- Works outside React components (in utility functions)

```tsx
import { create } from 'zustand';

interface CartStore {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  total: () => number;
}

const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  removeItem: (id) => set((state) => ({ items: state.items.filter(i => i.id !== id) })),
  total: () => get().items.reduce((sum, item) => sum + item.price, 0),
}));

// Usage — select only what you need (prevents unnecessary re-renders)
function CartCount() {
  const count = useCartStore((state) => state.items.length);
  return <span>{count}</span>;
}
```

### Zustand with Persistence
```tsx
import { persist } from 'zustand/middleware';

const useStore = create(
  persist<StoreState>(
    (set) => ({ /* ... */ }),
    { name: 'cart-storage' } // localStorage key
  )
);
```

---

## Redux Toolkit

### When to Use (Over Zustand)
- Very large, complex state with many slices
- Need Redux DevTools time-travel debugging
- Team already knows Redux
- Complex middleware requirements

```tsx
// Slice
const cartSlice = createSlice({
  name: 'cart',
  initialState: { items: [] as CartItem[] },
  reducers: {
    addItem: (state, action: PayloadAction<CartItem>) => {
      state.items.push(action.payload); // Immer allows mutation
    },
    removeItem: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter(i => i.id !== action.payload);
    },
  },
});

// Async thunk
const fetchCart = createAsyncThunk('cart/fetch', async (userId: string) => {
  const response = await api.getCart(userId);
  return response.data;
});
```

---

## URL State

### When to Use URL State
- Search/filter parameters
- Pagination (page, sort, order)
- Tab selection
- Any state that should survive page refresh or be shareable

### Next.js URL State
```tsx
'use client';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

function Filters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  const category = searchParams.get('category') ?? 'all';
  // ...
}
```

---

## Form State

### React Hook Form (Recommended)
```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const schema = z.object({
  email: z.string().email('Invalid email'),
  name: z.string().min(1, 'Name is required'),
});

type FormData = z.infer<typeof schema>;

function SignupForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    await createUser(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}

      <input {...register('email')} />
      {errors.email && <span>{errors.email.message}</span>}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : 'Sign Up'}
      </button>
    </form>
  );
}
```

### Form State Rules
- Validate with Zod schemas (shared between client and server)
- Use `react-hook-form` for uncontrolled forms (better performance)
- Use controlled inputs only when you need to react to every keystroke
- Disable submit button during submission
- Show inline errors on blur, not on every keystroke
