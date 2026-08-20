alter table reports
  drop constraint if exists activity_area_allowed;

update reports
set activity_area = case activity_area
  when 'チーム運営' then '事務局'
  when '資金調達・スポンサー' then 'ファンドレイジング'
  else activity_area
end
where activity_area in ('チーム運営', '資金調達・スポンサー');

alter table reports
  add constraint activity_area_allowed check (
    activity_area in (
      'ロボット',
      'アワード',
      'アウトリーチ',
      'ブランディング',
      'ファンドレイジング',
      '事務局',
      'その他'
    )
  );
