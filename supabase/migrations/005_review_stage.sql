alter table user_word_progress
  add column if not exists review_stage int not null default 0;

comment on column user_word_progress.review_stage is '0=learning (5 know to advance), 1=week review, 2=month review';
