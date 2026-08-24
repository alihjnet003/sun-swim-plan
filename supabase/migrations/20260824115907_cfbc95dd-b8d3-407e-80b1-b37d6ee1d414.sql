ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS show_in_popup boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS offers_single_popup_idx ON public.offers (show_in_popup) WHERE show_in_popup;

CREATE OR REPLACE FUNCTION public.enforce_single_popup_offer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.show_in_popup THEN
    UPDATE public.offers SET show_in_popup = false
    WHERE show_in_popup AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offers_single_popup ON public.offers;
CREATE TRIGGER offers_single_popup
BEFORE INSERT OR UPDATE OF show_in_popup ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_popup_offer();