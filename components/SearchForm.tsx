"use client";


type Props = {
  category: string;
  country: string;
  city: string;
  limit: number;
  running: boolean;
  onChange: (patch: Partial<Props>) => void;
  onSubmit: () => void;
};

export function SearchForm(props: Props) {
  return (
    <div className="card">
      <form
        id="lead-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <div className="row">
          <div>
            <label htmlFor="category">صنف / حوزه فعالیت</label>
            <input
              id="category"
              value={props.category}
              onChange={(e) => props.onChange({ category: e.target.value })}
              placeholder="لوازم آرایشی"
              required
            />
          </div>
          <div>
            <label htmlFor="country">کشور</label>
            <input
              id="country"
              value={props.country}
              onChange={(e) => props.onChange({ country: e.target.value })}
              placeholder="ایران"
              required
            />
          </div>
          <div>
            <label htmlFor="city">شهر</label>
            <input
              id="city"
              value={props.city}
              onChange={(e) => props.onChange({ city: e.target.value })}
              placeholder="تهران"
            />
          </div>
          <div>
            <label htmlFor="limit">تعداد لید جدید</label>
            <input
              id="limit"
              type="number"
              min={1}
              max={50}
              value={props.limit}
              onChange={(e) => props.onChange({ limit: Number(e.target.value) })}
            />
          </div>
        </div>
      </form>
      <div className="actions">
        <button type="submit" form="lead-search-form" disabled={props.running}>
          {props.running ? "در حال جستجو..." : "شروع جستجو"}
        </button>
        <a href="/leads" className="btn-secondary">
          لیدهای قبلی
        </a>
      </div>
    </div>
  );
}
