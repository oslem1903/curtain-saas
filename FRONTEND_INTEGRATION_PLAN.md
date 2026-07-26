# Frontend Integration Plan: Installation Completion with Earnings

**Status:** Design (Not Implemented Yet)  
**Target File:** `src/pages/InstallationTracking.tsx`  
**Related Files:** 
- `src/supabaseClient.ts` (RPC helper)
- `src/components/ConfirmDialog.tsx` (confirmation modal)

---

## 1. OVERVIEW

### Current State
- InstallationTracking page shows jobs list
- No "Montaj Tamamlandı" (Installation Complete) button
- Completion currently done via database direct call (not visible in UI)

### Target State
- Add "Montaj Tamamlandı" button on each job row
- Show confirmation modal before completion
- Display earnings summary before user confirms
- Call enhanced `update_installation_completion()` RPC
- Handle success/error responses
- Refresh jobs list after completion

---

## 2. COMPONENT CHANGES

### 2.1 InstallationTracking.tsx - Structure

```typescript
// New state variables needed:
const [selectedJobForCompletion, setSelectedJobForCompletion] = useState<Installation | null>(null);
const [completionInProgress, setCompletionInProgress] = useState(false);
const [estimatedEarnings, setEstimatedEarnings] = useState<{
  quantity_earning: number;
  area_earning: number;
  manual_earning: number;
  total_earning: number;
} | null>(null);

// New UI sections:
// - Row action button: "Montaj Tamamlandı"
// - Completion confirmation modal
// - Earnings summary display
// - Error toast notification
```

### 2.2 Button Placement

```jsx
{/* In job row, next to other action buttons */}
<button
  onClick={() => handleCompleteInstallation(job)}
  disabled={
    job.status === 'installation_completed' ||
    job.assigned_staff_id === null ||
    completionInProgress
  }
  className={`px-3 py-1 rounded text-sm font-medium ${
    job.status === 'installation_completed'
      ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
      : 'bg-green-600 hover:bg-green-700 text-white'
  }`}
  title={
    job.assigned_staff_id === null
      ? 'Montajcı atanmalı'
      : job.status === 'installation_completed'
      ? 'Zaten tamamlanmış'
      : ''
  }
>
  {completionInProgress ? 'İşleniyor...' : 'Montaj Tamamlandı'}
</button>
```

---

## 3. COMPLETION WORKFLOW

### 3.1 Handler Function

```typescript
async function handleCompleteInstallation(job: Installation) {
  try {
    setSelectedJobForCompletion(job);
    
    // Pre-fetch earnings estimate (optional - for display before confirmation)
    // This is just a display value, actual calculation happens in RPC
    const { data: commission, error } = await supabase.rpc(
      'calculate_commission_for_job',
      {
        p_job_id: job.id,
        p_installer_id: job.assigned_staff_id,
        p_company_id: job.company_id,
      }
    );
    
    if (!error && commission && commission[0]) {
      setEstimatedEarnings({
        quantity_earning: commission[0].quantity_earning || 0,
        area_earning: commission[0].area_earning || 0,
        manual_earning: commission[0].manual_earning || 0,
        total_earning: commission[0].total_earning || 0,
      });
    }
    
    // Show confirmation modal
    // Modal handles the actual completion call
  } catch (err) {
    showToast('error', 'Hesaplama sırasında hata oluştu');
    setSelectedJobForCompletion(null);
  }
}
```

### 3.2 Confirmation Modal

```typescript
async function confirmCompletion() {
  if (!selectedJobForCompletion) return;
  
  setCompletionInProgress(true);
  
  try {
    const { data, error } = await supabase.rpc(
      'update_installation_completion',
      {
        p_company_id: selectedJobForCompletion.company_id,
        p_job_id: selectedJobForCompletion.id,
        p_new_status: 'installation_completed',
        p_order_id: selectedJobForCompletion.order_id,
        p_order_new_status: 'montaj_tamamlandi', // or appropriate status
      }
    );
    
    if (error) {
      throw new Error(error.message);
    }
    
    if (!data.success) {
      throw new Error(data.error || 'Bilinmeyen hata');
    }
    
    // Success
    showToast('success', `Montaj tamamlandı. Hakediş: ${data.total_earning} TL`);
    
    // Refresh jobs list
    await refreshJobs();
    
    // Clear modal
    setSelectedJobForCompletion(null);
    setEstimatedEarnings(null);
    
  } catch (err: any) {
    showToast('error', `Hata: ${err.message}`);
  } finally {
    setCompletionInProgress(false);
  }
}
```

### 3.3 Modal Component

```jsx
{selectedJobForCompletion && (
  <ConfirmDialog
    title="Montaj Tamamlandı"
    message={`
      İş ID: ${selectedJobForCompletion.id}
      Müşteri: ${selectedJobForCompletion.customer_name}
      Montajcı: ${selectedJobForCompletion.installer_name}
      
      ${estimatedEarnings ? `
      Tahmini Hakediş:
      - Adet: ${estimatedEarnings.quantity_earning} TL
      - Alan: ${estimatedEarnings.area_earning} TL
      - Manuel: ${estimatedEarnings.manual_earning} TL
      - TOPLAM: ${estimatedEarnings.total_earning} TL
      ` : 'Hesaplama yapılıyor...'}
    `}
    onConfirm={confirmCompletion}
    onCancel={() => {
      setSelectedJobForCompletion(null);
      setEstimatedEarnings(null);
    }}
    isLoading={completionInProgress}
    confirmText="Tamamla"
    cancelText="Vazgeç"
    isDangerous={false}
  />
)}
```

---

## 4. ERROR HANDLING

### 4.1 Expected Error Scenarios

| Error | Cause | Frontend Action |
|-------|-------|-----------------|
| "Installer not assigned" | No assigned_staff_id | Disable button, show tooltip |
| "Not authorized" | User not admin/accountant | Show error toast |
| "Earnings already created" | Job completed twice | Show info: "Already complete" |
| "Rate limit exceeded" | Called 2x in 3 seconds | Show: "Please wait 3 seconds" |
| "Invalid status value" | Bug in RPC call | Show technical error |
| Network error | Supabase down | Show retry button |

### 4.2 Toast Notifications

```typescript
// Success
showToast('success', 'Montaj tamamlandı. Hakediş kaydı oluşturuldu.');

// Error cases
showToast('error', 'Montajcı atanmamış. Lütfen önce montajcı ataması yapın.');
showToast('error', 'Bu montaj zaten tamamlanmış.');
showToast('warning', 'Lütfen 3 saniye bekleyin.');
```

---

## 5. RESPONSE HANDLING

### 5.1 Success Response Structure

```json
{
  "success": true,
  "job_id": "uuid",
  "new_status": "installation_completed",
  "earning_id": "uuid",
  "transaction_id": "uuid",
  "total_earning": 450.00,
  "updated_at": "2026-07-11T14:30:00Z"
}
```

### 5.2 Frontend Processing

```typescript
if (data.success) {
  // Update local state to reflect completion
  setJobs(jobs.map(j => 
    j.id === data.job_id 
      ? { ...j, status: data.new_status, updated_at: data.updated_at }
      : j
  ));
  
  // Show earning amount
  showToast('success', `Hakediş: ${data.total_earning} TL kaydedildi`);
  
  // Optional: Redirect to Accounting to show new earning
  // Navigate to /accounting?tab=earnings&job_id=${data.job_id}
}
```

---

## 6. VALIDATION

### 6.1 Pre-Completion Checks

```typescript
function canCompleteJob(job: Installation): boolean {
  // 1. Installer assigned
  if (!job.assigned_staff_id) return false;
  
  // 2. Not already completed
  if (job.status === 'installation_completed') return false;
  
  // 3. Status is appropriate for completion
  if (!['onway', 'installing', 'assigned', 'planned'].includes(job.status)) {
    return false;
  }
  
  return true;
}
```

### 6.2 UI Feedback

```jsx
{/* Disabled button with reason */}
<button
  disabled={!canCompleteJob(job)}
  title={
    !job.assigned_staff_id ? 'Montajcı atanmalı' :
    job.status === 'installation_completed' ? 'Zaten tamamlanmış' :
    'Montaj tamamlandı'
  }
  {...buttonProps}
>
  Montaj Tamamlandı
</button>
```

---

## 7. UX FLOW DIAGRAM

```
User views InstallationTracking page
  ↓
User sees job with status "onway" or "installing"
  ↓
User clicks "Montaj Tamamlandı" button
  ↓
[Modal appears]
  ├─ Shows job details
  ├─ Shows installer name
  ├─ Shows estimated earnings (loading...)
  ├─ [Confirm] and [Cancel] buttons
  └─ Earnings details calculated in real-time
  ↓
User clicks [Confirm]
  ↓
RPC: update_installation_completion() called
  ├─ Validates installer assigned
  ├─ Calculates commission
  ├─ Creates installer_earnings record
  ├─ Creates installer_transactions record
  └─ Updates installation_jobs & orders
  ↓
Response received
  ├─ Success: Show toast + refresh list
  └─ Error: Show error toast + keep modal open
  ↓
Job status changes to "installation_completed"
  ↓
Button disabled (status already complete)
```

---

## 8. RELATED UI COMPONENTS

### 8.1 New Components Needed
- None (uses existing ConfirmDialog)

### 8.2 Existing Components to Update
- `InstallationTracking.tsx` - Main page
- `ConfirmDialog.tsx` - Already exists (reuse)

### 8.3 Utility Functions
- `showToast()` - Already exists
- `refreshJobs()` - Already exists

---

## 9. ACCESSIBILITY

### 9.1 ARIA Labels

```jsx
<button
  aria-label={`Montaj tamamla: ${job.customer_name}`}
  aria-disabled={!canCompleteJob(job)}
  role="button"
  {...buttonProps}
>
  Montaj Tamamlandı
</button>
```

### 9.2 Keyboard Navigation
- Tab to button
- Enter/Space to open modal
- Tab to confirm/cancel
- Escape to cancel

---

## 10. TESTING CHECKLIST

### Before Deployment

- [ ] Button appears on uncompleted jobs
- [ ] Button disabled on completed jobs
- [ ] Button disabled when installer not assigned
- [ ] Modal shows earnings estimate
- [ ] Confirmation creates earnings record
- [ ] Job status updates to installation_completed
- [ ] Success toast shows correct earning amount
- [ ] Error handling shows appropriate messages
- [ ] Concurrent requests handled (rate limiting)
- [ ] Keyboard navigation works
- [ ] Mobile responsive design

### Post-Deployment Monitoring

- [ ] Monitor RPC call success rate
- [ ] Check for "Earnings already created" errors (should be 0)
- [ ] Verify all completions have corresponding earnings
- [ ] Monitor rate limit hits (should be rare)
- [ ] Check for permission errors (admin/accountant only)

---

## 11. ROLLBACK PLAN

If frontend changes need rollback:

1. Remove "Montaj Tamamlandı" button
2. Remove completion modal
3. Remove earnings estimation display
4. Keep RPC call available (will still work, just not called from UI)
5. No state changes needed (button was just UI layer)

---

## 12. FUTURE ENHANCEMENTS

- [ ] Bulk completion (multiple jobs at once)
- [ ] Offline mode (queue completions, sync when online)
- [ ] Earnings editing (allow admin to adjust manual commissions)
- [ ] Completion history (show past completions with earnings)
- [ ] Export completion report (PDF or CSV)

---
